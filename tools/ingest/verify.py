"""verify: export 결과 SQL 을 임시 DB 에 적용해 원본(JSON·md·csv)과 대조한다. 출력에는 자료 내용을 넣지 않는다.

원본 재읽기는 model.py 와 별도 코드로 한다(같은 실수를 같이 하지 않게). 공유하는 것은 본문 정리 규칙 esc() 뿐이다.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .config import Config
from .export import MANIFEST, REPO_ROOT, VERIFY
from .model import esc, role_of
from .sqlgen import FORBIDDEN_TABLES, INSERT_ORDER, SqlError, validate_sql

MIGRATIONS_DIR = REPO_ROOT / "migrations"
MEDIA_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".mp4", ".mov")


@dataclass
class Check:
    id: str
    title: str
    ok: bool
    detail: str
    warn: bool = False  # 실패는 아니지만 알려야 하는 항목(종료 코드에 영향 없음)


def _sample(items: list[str], n: int = 5) -> str:
    return ", ".join(items[:n]) + (f" 외 {len(items) - n}건" if len(items) > n else "")


def open_db(out_dir: Path, manifest: dict) -> sqlite3.Connection:  # type: ignore[type-arg]
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    for m in sorted(MIGRATIONS_DIR.glob("*.sql")):
        conn.executescript(m.read_text(encoding="utf-8"))
    for f in manifest["files"]:
        conn.executescript((out_dir / f["name"]).read_bytes().decode("utf-8"))
    return conn


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _parse_age(s: str) -> int | None:
    m = re.match(r"\s*(\d+)년\s*(\d+)개월", s)
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def _frontmatter(text: str) -> dict[str, str]:
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    out: dict[str, str] = {}
    if m:
        for line in m.group(1).split("\n"):
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def verify(data_dir: Path, out_dir: Path, cfg: Config) -> list[Check]:
    checks: list[Check] = []

    def add(cid: str, title: str, bad: list[str], ok_detail: str) -> None:
        checks.append(Check(cid, title, not bad, ok_detail if not bad else _sample(bad)))

    mpath = out_dir / MANIFEST
    if not mpath.is_file():
        return [Check("F1", "manifest 존재", False, "manifest.json 이 없습니다")]
    manifest = json.loads(mpath.read_text(encoding="utf-8"))

    # F1 파일 해시: export 결과가 manifest 와 같고, 모르는 파일이 없다
    bad: list[str] = []
    listed = {f["name"] for f in manifest["files"]}
    for f in manifest["files"]:
        p = out_dir / f["name"]
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != f["sha256"]:
            bad.append(f["name"])
    extra = [p.name for p in out_dir.glob("*.sql") if p.name not in listed and p.name != "_run_start.sql"]
    bad += [f"manifest 에 없는 파일 {n}" for n in extra]
    add("F1", "export 파일 해시 = manifest", bad, f"{len(listed)}개 파일")

    # F2 SQL 문법 형태·화이트리스트·금지 테이블
    bad, forbidden, nstmt = [], [], 0
    for f in manifest["files"]:
        text = (out_dir / f["name"]).read_bytes().decode("utf-8")
        try:
            ops = validate_sql(text)
        except SqlError as e:
            bad.append(f"{f['name']}: {e}")
            continue
        nstmt += len(ops)
        forbidden += [t for _, t in ops if t in FORBIDDEN_TABLES]
    if forbidden:
        bad.append(f"금지 테이블 포함: {sorted(set(forbidden))}")
    add("F2", "SQL 문장 형태·테이블 화이트리스트·금지 테이블(family_log 등) 없음", bad, f"{nstmt}문장")
    if bad:
        return checks

    # F3 적용: 중복 키 0, NOT NULL·CHECK·FK 통과(스키마가 강제)
    try:
        db = open_db(out_dir, manifest)
    except sqlite3.Error as e:
        checks.append(Check("F3", "임시 DB 적용(중복 키·필수 필드·FK)", False, f"{type(e).__name__}: {e}"))
        return checks
    checks.append(Check("F3", "임시 DB 적용(중복 키·필수 필드·FK)", True, "오류 없음"))
    with db:
        fk = db.execute("PRAGMA foreign_key_check").fetchall()
        add("F3b", "외래 키 위반 0", [str(r[:2]) for r in fk], "0건")
        empties: list[str] = []
        for table, col in (
            ("note_day", "class_name"),
            ("note_item", "author_role"),
            ("note_item", "posted_at"),
            ("note_comment", "posted_at"),
            ("milestone", "milestone_ko"),
            ("report_doc", "title"),
            ("report_doc", "sha256"),
            ("checkup", "overall"),
            ("checkup", "dev_result"),
        ):
            n = db.execute(f"SELECT COUNT(*) FROM {table} WHERE {col} IS NULL OR {col} = ''").fetchone()[0]
            if n:
                empties.append(f"{table}.{col} {n}건")
        add("F3c", "필수 필드 비어 있지 않음(본문·첫 줄은 빈 값 허용)", empties, "0건")

    # 원본 재읽기 (model.py 와 별도)
    rj = sorted(data_dir.glob(cfg.reports_json))
    raw = json.loads(rj[0].read_text(encoding="utf-8"))
    reports = raw["reports"]
    notes: dict[str, str] = {}
    for p in (data_dir / cfg.notes_dir).rglob("*.md"):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem):
            notes[p.stem] = p.read_text(encoding="utf-8")
    dates = sorted({r["date"] for r in reports})
    n_comments = sum(len(r["comments"]) for r in reports)
    q = lambda sql: db.execute(sql).fetchone()[0]  # noqa: E731
    got = (
        q("SELECT COUNT(*) FROM note_day"),
        q("SELECT COUNT(*) FROM note_item"),
        q("SELECT COUNT(*) FROM note_comment"),
    )
    fm = {d: _frontmatter(t) for d, t in notes.items()}
    md_reports = sum(int(f.get("reports", "0")) for f in fm.values())
    md_comments = sum(int(f.get("comments", "0")) for f in fm.values())
    md_images = sum(int(f.get("images", "0")) for f in fm.values())
    bad = []
    if got != (len(dates), len(reports), n_comments):
        bad.append(f"SQL {got} != 원본 JSON {(len(dates), len(reports), n_comments)}")
    if len(notes) != len(dates) or set(notes) != set(dates):
        bad.append(f"일자 md {len(notes)}개 != 원본 일수 {len(dates)}")
    if (md_reports, md_comments) != (len(reports), n_comments):
        bad.append(f"md 합계 (알림장 {md_reports}, 댓글 {md_comments}) != 원본")
    if md_images != sum(int(r["n_images"]) for r in reports):
        bad.append("md 사진 합계 != 원본")
    if (
        q("SELECT COALESCE(SUM(n_reports),0) FROM note_day") != len(reports)
        or q("SELECT COALESCE(SUM(n_comments),0) FROM note_day") != n_comments
    ):
        bad.append("note_day 의 n_reports/n_comments 합계 불일치")
    add(
        "I1",
        "알림장 일수·건수·댓글 수 = 원본 JSON = 일자 md",
        bad,
        f"일수 {got[0]} · 알림장 {got[1]} · 댓글 {got[2]}",
    )

    # I2 본문·댓글 전 줄이 md 와 SQL 에 존재
    bad = []
    db_items = {r[0]: r[1] for r in db.execute("SELECT report_id, body FROM note_item")}
    db_comments: dict[int, list[str]] = {}
    for rid, body in db.execute("SELECT report_id, body FROM note_comment ORDER BY report_id, posted_at, id"):
        db_comments.setdefault(rid, []).append(body)
    for r in reports:
        md = notes.get(r["date"], "")
        content = esc(r["content"])
        if db_items.get(r["id"]) != content:
            bad.append(f"본문 불일치 report {r['id']}")
        for line in content.split("\n"):
            if line.strip() and line not in md:
                bad.append(f"md 에 없는 본문 줄 report {r['id']}")
                break
        want = [esc(c["txt"]) for c in sorted(r["comments"], key=lambda c: c["t"])]
        if db_comments.get(r["id"], []) != want:
            bad.append(f"댓글 불일치 report {r['id']}")
        for c in r["comments"]:
            for line in esc(c["txt"]).split("\n"):
                if line.strip() and line not in md:
                    bad.append(f"md 에 없는 댓글 줄 report {r['id']}")
                    break
    add(
        "I2",
        "모든 본문·댓글 줄이 SQL 과 일자 md 에 존재",
        bad,
        f"본문 {len(reports)}건 · 댓글 {n_comments}건 전 줄",
    )

    # I3 관측 스니펫이 해당 날짜 본문(또는 댓글)에 존재
    day_text: dict[str, str] = {}
    for d, body in db.execute("SELECT date, body FROM note_item"):
        day_text[d] = day_text.get(d, "") + " " + body
    for d, body in db.execute("SELECT i.date, c.body FROM note_comment c JOIN note_item i USING(report_id)"):
        day_text[d] = day_text.get(d, "") + " " + body
    # 관측 스니펫은 일자 md 에서 떼어 낸 것이라 댓글 머리줄·마크다운 기호가 섭여 있다 -> md 와 SQL 본문 중 하나에 있으면 통과
    day_norm = {d: _norm(t) for d, t in day_text.items()}
    md_norm = {d: _norm(t) for d, t in notes.items()}
    bad = []
    n_obs = 0
    for oid, d, snip in db.execute("SELECT id, date, snippet FROM observation"):
        n_obs += 1
        s = _norm(snip).strip("…").strip()
        s = re.sub(r"^\.\.\.|\.\.\.$", "", s).strip()
        if s not in md_norm.get(d, "") and s not in day_norm.get(d, ""):
            bad.append(f"observation {oid}")
    add("I3", "관측 스니펫이 해당 날짜 일자 md(또는 SQL 본문)에 존재", bad, f"{n_obs}건")

    # I4 문서 해시: 적재 해시 = body 해시 = 지금 원본 파일 해시(export 이후 변경 없음)
    bad = []
    changed = []
    for rel, sha in manifest["sources"].items():
        p = data_dir / rel
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != sha:
            changed.append(rel)
    if changed:
        bad.append(f"export 이후 원본이 바뀐 파일 {len(changed)}개")
    shas = set(manifest["sources"].values())
    ndocs = 0
    for slug, sha, body in db.execute("SELECT slug, sha256, body FROM report_doc"):
        ndocs += 1
        if hashlib.sha256((body or "").encode("utf-8")).hexdigest() != sha or sha not in shas:
            bad.append(f"문서 {slug}")
    add(
        "I4",
        "문서 sha256 = 원본 파일(적재 후 body 와도 일치)",
        bad,
        f"문서 {ndocs}건 · 원본 {len(manifest['sources'])}개 해시",
    )

    # I5 실명이 author_role 에 없음
    names = {str(r["author"]) for r in reports} | {str(c["name"]) for r in reports for c in r["comments"]}
    names = {n for n in names if len(n) >= 2}
    roles = {r[0] for r in db.execute("SELECT DISTINCT author_role FROM note_item")}
    expected = {role_of(r["author_name"]) for r in reports}
    bad = []
    if roles != expected:
        bad.append("author_role 집합이 원본 역할과 다름")
    for role in roles:
        if len(role) > 12 or any(n in role for n in names):
            bad.append("author_role 에 실명 의심")
    add("I5", "교사·보호자 실명이 author_role 에 없음", bad, f"역할 {len(roles)}종")

    # I6 S2 는 s2/ 접두어 밖으로 나가지 않고, 사진·영상은 적재하지 않는다
    bad = []
    for cid, key in db.execute("SELECT id, source_image_key FROM checkup WHERE source_image_key IS NOT NULL"):
        if not key.startswith("s2/"):
            bad.append(f"checkup {cid}")
    media = [rel for rel in manifest["sources"] if rel.lower().endswith(MEDIA_EXT)]
    if media:
        bad.append(f"사진·영상 원본이 입력에 포함됨 {len(media)}개")
    add("I6", "S2 키는 s2/ 접두어만, 사진·영상 미적재", bad, "원본 사진 제외")

    # D1 날짜 범위
    lo, hi = q("SELECT MIN(date) FROM note_day"), q("SELECT MAX(date) FROM note_day")
    bad = []
    if (lo, hi) != (dates[0], dates[-1]):
        bad.append("범위가 원본과 다름")
    if (manifest["date_range"]["min"], manifest["date_range"]["max"]) != (lo, hi):
        bad.append("manifest 범위와 다름")
    for d in dates:
        date.fromisoformat(d)
    for d, a in db.execute("SELECT date, age_months FROM note_day"):
        m = _parse_age(fm.get(d, {}).get("age", ""))
        if m is not None and m != a:
            bad.append(f"월령 불일치 {d}")
    add("I8", "날짜 범위 = 원본, 월령 = md 월령", bad, f"{lo} ~ {hi}")

    # I7 건수: SQL 적용 DB = manifest (원격은 upload/status 가 같은 비교를 한다)
    bad = []
    for t in INSERT_ORDER:
        n = q(f"SELECT COUNT(*) FROM {t}")
        if n != manifest["tables"][t]:
            bad.append(f"{t} {n}!={manifest['tables'][t]}")
    add(
        "I7",
        "적용 DB 건수 = manifest 건수 (원격 비교는 upload·status)",
        bad,
        ", ".join(f"{t}={manifest['tables'][t]}" for t in INSERT_ORDER),
    )
    db.close()

    # L1 계층별 검증기 결과(R1-7): 실패해도 verify 는 통과하되 WARN 으로 계층 이름을 알린다
    warns = [str(w) for w in manifest.get("layer_warnings", [])]
    checks.append(
        Check(
            "L1",
            "원본 계층별 검증기(verify_*.py) 결과 — 통과 못 한 계층의 문서는 verify_ok=0",
            True,
            ", ".join(warns) if warns else "모든 계층 통과",
            warn=bool(warns),
        )
    )
    return checks


def write_report(out_dir: Path, checks: list[Check]) -> dict:  # type: ignore[type-arg]
    rep = {
        "manifest_sha256": hashlib.sha256((out_dir / MANIFEST).read_bytes()).hexdigest(),
        "ok": all(c.ok for c in checks),
        "checks": [
            {"id": c.id, "title": c.title, "ok": c.ok, "detail": c.detail, "warn": c.warn} for c in checks
        ],
    }
    (out_dir / VERIFY).write_bytes((json.dumps(rep, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return rep
