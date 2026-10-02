"""DATA_DIR(읽기 전용) -> 테이블 행. 원본에 없는 값은 NULL, 판정 문구는 만들지 않는다(원문 그대로).

대응(docs/03, docs/07):
- note_day/note_item/note_comment <- 알림장 원본 JSON (실명은 저장하지 않고 역할만)
- milestone <- evidence/milestones.csv, observation <- tracking/observations.csv
- growth_ref <- evidence/growth.csv (스키마에 있는 칸만)
- checkup/measurement <- 검진 결과 표(xlsx 또는 같은 열의 csv) (사진은 적재하지 않음)
- report_doc <- guide·wiki·tracking·report 문서 원문(body 칸, 마이그레이션 0004_report_doc_body)
"""

from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import re
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from .config import Config
from .xlsx import read_xlsx_rows

Row = dict[str, str | int | float | None]

WEATHER = {
    "sunny": "맑음",
    "mostly_cloudy": "구름많음",
    "overcast": "흐림",
    "rain": "비",
    "partly_cloudy": "구름조금",
    "fog": "안개",
    "sunny_after_rain": "비온뒤갬",
    "mixed_rain_snow": "진눈깨비",
    "snow": "눈",
    "yellow_sand": "황사",
    "thunderstorm": "뇌우",
}
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


class SourceError(ValueError):
    """원본이 기대와 다르다. 메시지에는 자료 내용을 넣지 않는다(파일 상대경로·행 번호·칸 이름만)."""


# ───────────────────────── 읽기 도구 ─────────────────────────
class Sources:
    """읽은 파일을 기록(상대경로 -> sha256)하고 DATA_DIR 밖으로 나가는 경로를 막는다."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.hashes: dict[str, str] = {}
        if not self.root.is_dir():
            raise SourceError("DATA_DIR 이 폴더가 아닙니다")

    def rel(self, p: Path) -> str:
        return p.resolve().relative_to(self.root).as_posix()

    def _check(self, p: Path) -> Path:
        r = p.resolve()
        if not r.is_relative_to(self.root):
            raise SourceError("DATA_DIR 밖의 경로는 읽지 않습니다")
        return r

    def read(self, p: Path) -> bytes:
        r = self._check(p)
        data = r.read_bytes()
        self.hashes[self.rel(r)] = hashlib.sha256(data).hexdigest()
        return data

    def read_text(self, p: Path) -> str:
        try:
            return self.read(p).decode("utf-8")
        except UnicodeDecodeError as e:
            raise SourceError(f"UTF-8 이 아닙니다: {self.rel(p)}") from e

    def glob(self, pattern: str) -> list[Path]:
        out = [p for p in self.root.glob(pattern) if p.is_file()]
        for p in out:
            self._check(p)
        return sorted(out, key=lambda p: self.rel(p))

    def one(self, pattern: str) -> Path:
        found = self.glob(pattern)
        if len(found) != 1:
            raise SourceError(f"'{pattern}' 와 일치하는 파일이 {len(found)}개입니다(1개여야 함)")
        return found[0]

    def require(self, relpath: str) -> Path:
        p = self.root / relpath
        if not p.is_file():
            raise SourceError(f"파일이 없습니다: {relpath}")
        return self._check(p)


def read_csv(src: Sources, p: Path, required: tuple[str, ...]) -> list[dict[str, str]]:
    text = src.read_text(p).lstrip("\ufeff")
    rd = csv.DictReader(io.StringIO(text, newline=""))
    missing = [c for c in required if c not in (rd.fieldnames or [])]
    if missing:
        raise SourceError(f"{src.rel(p)}: 열이 없습니다 {missing}")
    return list(rd)


def num_or_none(v: str | None) -> float | None:
    if v is None or v.strip() in ("", "NA", "NaN", "nan", "None", "null"):
        return None
    return float(v)


def need_int(v: str, where: str) -> int:
    try:
        return int(v.strip())
    except ValueError as e:
        raise SourceError(f"{where}: 정수가 아닙니다") from e


def need_date(v: str, where: str) -> str:
    v = v.strip()
    if not DATE_RE.fullmatch(v):
        raise SourceError(f"{where}: YYYY-MM-DD 형식이 아닙니다")
    try:
        date.fromisoformat(v)
    except ValueError as e:
        raise SourceError(f"{where}: 존재하지 않는 날짜입니다") from e
    return v


# ───────────────────────── 알림장 ─────────────────────────
def esc(s: str | None) -> str:
    """기존 build_md.py 와 같은 본문 정리: CRLF -> LF, 앞뒤 공백 제거."""
    return (s or "").replace("\r\n", "\n").strip()


def kst(iso: str) -> str:
    """키즈노트 UTC(Z) -> KST(+9), 분 단위. 기존 build_md.py 와 같다."""
    t = datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S") + timedelta(hours=9)
    return t.strftime("%Y-%m-%d %H:%M")


def role_of(author_name: str) -> str:
    parts = author_name.split()
    if not parts:
        raise SourceError("author_name 이 비어 있습니다")
    return parts[-1]


def is_from_home(author_name: str) -> bool:
    return author_name.endswith(("엄마", "아빠"))


def age_months(birth: date, d: date) -> int:
    n = (d.year - birth.year) * 12 + d.month - birth.month
    if d.day < birth.day:
        n -= 1
    return n


@dataclass
class RawComment:
    idx: int
    t: str
    who: str
    name: str
    txt: str


@dataclass
class RawReport:
    id: int
    date: str
    weather: str
    class_name: str
    author: str
    author_name: str
    created: str
    n_images: int
    content: str
    comments: list[RawComment] = field(default_factory=list)


def load_reports(src: Sources, cfg: Config) -> tuple[date, list[RawReport]]:
    p = src.one(cfg.reports_json)
    where = src.rel(p)
    try:
        data = json.loads(src.read_text(p))
        birth = date.fromisoformat(data["meta"]["birth"])
        items = data["reports"]
    except (ValueError, KeyError, TypeError) as e:
        raise SourceError(f"{where}: meta.birth / reports 를 읽을 수 없습니다") from e
    out: list[RawReport] = []
    seen: set[int] = set()
    for i, r in enumerate(items):
        w = f"{where} reports[{i}]"
        try:
            rid = r["id"]
            if not isinstance(rid, int) or isinstance(rid, bool):
                raise SourceError(f"{w}: id 가 정수가 아닙니다")
            if rid in seen:
                raise SourceError(f"{w}: report id 중복")
            seen.add(rid)
            rep = RawReport(
                id=rid,
                date=need_date(r["date"], f"{w}.date"),
                weather=str(r.get("weather", "")),
                class_name=str(r["class_name"]),
                author=str(r["author"]),
                author_name=str(r["author_name"]),
                created=str(r["created"]),
                n_images=int(r["n_images"]),
                content=str(r["content"]),
            )
            kst(rep.created)
        except (KeyError, TypeError, ValueError) as e:
            raise SourceError(f"{w}: 필수 칸이 없거나 형식이 다릅니다") from e
        for j, c in enumerate(r["comments"]):
            try:
                who = c["who"]
                if who not in ("parent", "teacher"):
                    raise SourceError(f"{w}.comments[{j}]: who 값이 허용되지 않습니다")
                kst(c["t"])
                rep.comments.append(RawComment(j, c["t"], who, str(c["name"]), str(c["txt"])))
            except (KeyError, TypeError, ValueError) as e:
                raise SourceError(f"{w}.comments[{j}]: 칸이 없거나 형식이 다릅니다") from e
        if len(rep.comments) > 999:
            raise SourceError(f"{w}: 댓글이 999개를 넘습니다")
        out.append(rep)
    return birth, out


def build_notes(birth: date, reports: list[RawReport]) -> tuple[list[Row], list[Row], list[Row]]:
    by_date: dict[str, list[RawReport]] = {}
    for r in reports:
        by_date.setdefault(r.date, []).append(r)
    days: list[Row] = []
    items: list[Row] = []
    comments: list[Row] = []
    for ds in sorted(by_date):
        group = by_date[ds]  # 원본 순서 = 파일의 '알림장 1/2, 2/2' 순서
        head = group[0]
        days.append(
            {
                "date": ds,
                "class_name": head.class_name,
                "age_months": age_months(birth, date.fromisoformat(ds)),
                "n_reports": len(group),
                "n_images": sum(x.n_images for x in group),
                "n_comments": sum(len(x.comments) for x in group),
                "first_line": esc(head.content).split("\n")[0],
            }
        )
    for r in sorted(reports, key=lambda x: x.id):
        items.append(
            {
                "report_id": r.id,
                "date": r.date,
                "author_role": role_of(r.author_name),
                "direction": "to_center" if is_from_home(r.author_name) else "to_home",
                "weather": (WEATHER.get(r.weather, r.weather) or None),
                "posted_at": kst(r.created),
                "body": esc(r.content),
            }
        )
        ordered = sorted(r.comments, key=lambda c: (c.t, c.idx))
        for seq, c in enumerate(ordered, 1):
            comments.append(
                {
                    "id": r.id * 1000 + seq,
                    "report_id": r.id,
                    "who": c.who,
                    "posted_at": kst(c.t),
                    "body": esc(c.txt),
                }
            )
    return days, items, comments


# ───────────────────────── 근거·관측·성장 ─────────────────────────
def build_milestones(src: Sources, cfg: Config) -> list[Row]:
    p = src.require(cfg.milestones_csv)
    req = ("evidence_id", "source_id", "domain_ko", "age_month", "milestone_ko")
    rows: list[Row] = []
    seen: set[str] = set()
    for i, r in enumerate(read_csv(src, p, req), 2):
        w = f"{src.rel(p)}:{i}"
        eid = r["evidence_id"].strip()
        if not eid or eid in seen:
            raise SourceError(f"{w}: evidence_id 가 비었거나 중복입니다")
        seen.add(eid)
        rows.append(
            {
                "evidence_id": eid,
                "domain_ko": r["domain_ko"],
                "age_month": need_int(r["age_month"], f"{w} age_month"),
                "milestone_ko": r["milestone_ko"],
                "source_id": r["source_id"],
            }
        )
    return sorted(rows, key=lambda x: str(x["evidence_id"]))


def build_observations(src: Sources, cfg: Config, milestone_ids: set[str]) -> list[Row]:
    p = src.require(cfg.observations_csv)
    req = ("evidence_id", "date", "age_months", "section", "confidence", "subject_near", "snippet")
    rows: list[Row] = []
    for i, r in enumerate(read_csv(src, p, req), 1):
        w = f"{src.rel(p)} 데이터 {i}번째 행"
        if r["evidence_id"] not in milestone_ids:
            raise SourceError(f"{w}: 이정표 목록에 없는 evidence_id")
        if r["confidence"] not in ("HIGH", "MED"):
            raise SourceError(f"{w}: confidence 는 HIGH/MED 여야 합니다")
        if r["subject_near"] not in ("YES", "NO"):
            raise SourceError(f"{w}: subject_near 는 YES/NO 여야 합니다")
        rows.append(
            {
                "id": i,
                "evidence_id": r["evidence_id"],
                "date": need_date(r["date"], f"{w} date"),
                "age_months": need_int(r["age_months"], f"{w} age_months"),
                "section": r["section"],
                "confidence": r["confidence"],
                "subject_near": 1 if r["subject_near"] == "YES" else 0,
                "snippet": r["snippet"],
            }
        )
    return rows


def build_growth(src: Sources, cfg: Config) -> list[Row]:
    p = src.require(cfg.growth_csv)
    req = ("growth_id", "source_id", "measure", "sex", "age_month", "L", "M", "S", "p3", "p50", "p97")
    rows: list[Row] = []
    seen: set[str] = set()
    for i, r in enumerate(read_csv(src, p, req), 2):
        w = f"{src.rel(p)}:{i}"
        gid = r["growth_id"].strip()
        if not gid or gid in seen:
            raise SourceError(f"{w}: growth_id 가 비었거나 중복입니다")
        seen.add(gid)
        try:
            rows.append(
                {
                    "growth_id": gid,
                    "source_id": r["source_id"],
                    "measure": r["measure"],
                    "sex": r["sex"],
                    "age_month": need_int(r["age_month"], f"{w} age_month"),
                    "l": num_or_none(r["L"]),
                    "m": num_or_none(r["M"]),
                    "s": num_or_none(r["S"]),
                    "p3": num_or_none(r["p3"]),
                    "p50": num_or_none(r["p50"]),
                    "p97": num_or_none(r["p97"]),
                }
            )
        except ValueError as e:
            raise SourceError(f"{w}: 숫자 칸 형식 오류") from e
    return sorted(rows, key=lambda x: str(x["growth_id"]))


# ───────────────────────── 검진 ─────────────────────────
CHECKUP_COLS = ("구분", "항목", "값", "단위", "백분위", "판정/체크", "판독상태", "근거·비고")


def read_checkup_table(src: Sources, p: Path, cfg: Config) -> list[dict[str, str]]:
    if p.suffix.lower() == ".xlsx":
        raw = read_xlsx_rows(src.read(p), cfg.checkup_sheet)
    elif p.suffix.lower() == ".csv":
        raw = list(csv.reader(io.StringIO(src.read_text(p).lstrip("\ufeff"), newline="")))
    else:
        raise SourceError(f"{src.rel(p)}: xlsx 또는 csv 만 읽습니다")
    if not raw:
        raise SourceError(f"{src.rel(p)}: 비어 있습니다")
    head = raw[0]
    missing = [c for c in CHECKUP_COLS if c not in head]
    if missing:
        raise SourceError(f"{src.rel(p)}: 열이 없습니다 {missing}")
    idx = {c: head.index(c) for c in CHECKUP_COLS}
    return [{c: (r[i] if i < len(r) else "") for c, i in idx.items()} for r in raw[1:] if any(r)]


def build_checkups(src: Sources, cfg: Config) -> tuple[list[Row], list[Row]]:
    files = src.glob(cfg.checkup_glob)
    parsed: list[tuple[str, str, list[dict[str, str]]]] = []
    for p in files:
        rows = read_checkup_table(src, p, cfg)
        w = src.rel(p)

        def one(item: str, rows: list[dict[str, str]] = rows, w: str = w) -> dict[str, str]:
            hit = [r for r in rows if r["항목"] == item]
            if len(hit) != 1:
                raise SourceError(f"{w}: 항목 '{item}' 이(가) {len(hit)}행입니다(1행이어야 함)")
            return hit[0]

        raw_date = one("검진일")["값"].strip().replace("/", "-")
        if re.fullmatch(r"\d{8}", raw_date):
            raw_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
        exam = need_date(raw_date, f"{w} 검진일")
        parsed.append((exam, w, rows))
    parsed.sort(key=lambda x: (x[0], x[1]))
    checkups: list[Row] = []
    measures: list[Row] = []
    for cid, (exam, w, rows) in enumerate(parsed, 1):

        def one2(item: str, rows: list[dict[str, str]] = rows, w: str = w) -> str:
            hit = [r for r in rows if r["항목"] == item]
            if len(hit) != 1:
                raise SourceError(f"{w}: 항목 '{item}' 이(가) {len(hit)}행입니다(1행이어야 함)")
            return hit[0]["값"].strip()

        form = one2("서식")
        m = re.search(r"(\d+\s*~\s*\d+\s*개월용)", form)
        age = re.search(r"(\d+)\s*개월", one2("검진 시 월령"))
        if not age:
            raise SourceError(f"{w}: '검진 시 월령' 에서 개월 수를 읽지 못했습니다")
        overall = one2("종합판정")
        dev = one2("발달 평가 결과")
        if not overall or not dev:
            raise SourceError(f"{w}: 종합판정/발달 평가 결과 가 비어 있습니다")
        remarks = one2("소견 및 조치사항")
        checkups.append(
            {
                "id": cid,
                "round_label": m.group(1) if m else form,
                "exam_date": exam,
                "age_months": int(age.group(1)),
                "overall": overall,
                "remarks": remarks or None,
                "dev_result": dev,
                "source_image_key": None,
            }
        )
        for r in rows:
            if r["구분"] != "신체계측":
                continue
            measure = cfg.measure_labels.get(r["항목"])
            if measure is None:
                raise SourceError(f"{w}: 알 수 없는 계측 항목 (measure_labels 에 추가하세요)")
            status = r["판독상태"].strip()
            if status not in ("CONFIRMED", "UNCERTAIN"):
                raise SourceError(f"{w}: 판독상태는 CONFIRMED/UNCERTAIN 이어야 합니다")
            try:
                value = float(r["값"])
                pct = int(float(r["백분위"])) if r["백분위"].strip() else None
            except ValueError as e:
                raise SourceError(f"{w}: 계측 값/백분위가 숫자가 아닙니다") from e
            measures.append(
                {
                    "id": len(measures) + 1,
                    "checkup_id": cid,
                    "measured_on": exam,
                    "measure": measure,
                    "value": value,
                    "sheet_percentile": pct,
                    "read_status": status,
                    "condition_note": r["근거·비고"].strip() or None,
                }
            )
    return checkups, measures


# ───────────────────────── 문서 ─────────────────────────
def doc_title(kind: str, text: str, fallback: str) -> str:
    if kind == "markdown":
        m = re.search(r"^#\s+(.+?)\s*$", text, re.M)
        if m:
            return m.group(1)
    else:
        m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
        if m and m.group(1).strip():
            return html.unescape(re.sub(r"\s+", " ", m.group(1))).strip()
        m = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S | re.I)
        if m:
            return html.unescape(re.sub(r"<[^>]+>|\s+", " ", m.group(1))).strip()
    return fallback


def _slug_part(text: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", text.lower()).strip("-_")
    return s or hashlib.sha1(text.encode("utf-8")).hexdigest()[:6]


def doc_slug(rel: str, used: set[str]) -> str:
    """문서 주소 규칙: `<폴더>-<번호 또는 영문 이름>` (ASCII, 서버 slug 형식 ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$).

    폴더 이름이 묶음(guide/wiki/그 외=보고서)을 정한다(server/routes/reports.ts reportGroup).
    파일 이름이 `05-제목.md` 처럼 숫자로 시작하면 숫자만 쓴다(`guide-05`, 가족 기록 경고 가이드의 `guide/05`
    와 같은 주소). 그렇지 않으면 영문·숫자만 남기고(없으면 이름의 해시 6자). 겹치면 `-2`, `-3` 을 붙인다.
    """
    folder, _, name = rel.partition("/")
    stem = name.rsplit(".", 1)[0] if name else folder
    m = re.match(r"\d+", stem)
    key = m.group(0) if m else _slug_part(stem)
    base = f"{_slug_part(folder)}-{key}"[:76]
    slug, n = base, 1
    while slug.lower() in used:
        n += 1
        slug = f"{base}-{n}"
    used.add(slug.lower())
    return slug


def git_commit(data_dir: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "-C", str(data_dir), "rev-parse", "--short=12", "HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    out = r.stdout.strip()
    return out if r.returncode == 0 and re.fullmatch(r"[0-9a-f]{7,40}", out) else "unknown"


def build_docs(src: Sources, cfg: Config, commit: str) -> list[Row]:
    excluded = set(cfg.docs_exclude)
    picked: dict[str, tuple[Path, str]] = {}
    for rule in cfg.docs:
        for p in src.glob(f"{rule.dir}/{rule.glob}"):
            rel = src.rel(p)
            if rel in excluded:
                continue
            picked.setdefault(rel, (p, rule.kind))
    rels = sorted(picked)
    rows: list[Row] = []
    used: set[str] = set()
    for rel in rels:
        p, kind = picked[rel]
        slug = doc_slug(rel, used)
        raw = src.read(p)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as e:
            raise SourceError(f"UTF-8 이 아닙니다: {rel}") from e
        mtime = datetime.fromtimestamp(p.stat().st_mtime, UTC).strftime("%Y-%m-%d")
        rows.append(
            {
                "slug": slug,
                "title": doc_title(kind, text, Path(rel).stem),
                "kind": kind,
                "r2_key": "",  # 본문은 D1 body 칸(이 값이 빈 문자열이면 R2 가 아님)
                "generated_at": mtime,
                "source_commit": commit,
                "verify_ok": 0,  # upload 가 I4 통과 후 1 로 올린다
                "sha256": hashlib.sha256(raw).hexdigest(),
                "body": text,
            }
        )
    return sorted(rows, key=lambda x: str(x["slug"]))


# ───────────────────────── 전체 ─────────────────────────
@dataclass
class Built:
    tables: dict[str, list[Row]]
    sources: dict[str, str]
    source_commit: str
    birth: date


def build_all(data_dir: Path, cfg: Config) -> Built:
    src = Sources(data_dir)
    birth, reports = load_reports(src, cfg)
    days, items, comments = build_notes(birth, reports)
    milestones = build_milestones(src, cfg)
    ids = {str(m["evidence_id"]) for m in milestones}
    commit = git_commit(src.root)
    checkups, measures = build_checkups(src, cfg)
    tables = {
        "note_day": days,
        "note_item": items,
        "note_comment": comments,
        "milestone": milestones,
        "observation": build_observations(src, cfg, ids),
        "growth_ref": build_growth(src, cfg),
        "checkup": checkups,
        "measurement": measures,
        "report_doc": build_docs(src, cfg, commit),
    }
    return Built(tables, dict(sorted(src.hashes.items())), commit, birth)
