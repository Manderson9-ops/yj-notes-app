"""fixture DATA_DIR -> export -> verify -> (임시 DB) 건수 대조, 결정성, 경계값, 변조 감지."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path

import pytest

from tools.ingest.config import ConfigError, load_config, parse_config
from tools.ingest.export import (
    MANIFEST,
    REPO_ROOT,
    ExportError,
    assert_safe_out,
    generate,
    manifest_text,
    write_output,
)
from tools.ingest.model import SourceError, Sources, build_all, load_reports
from tools.ingest.sqlgen import FORBIDDEN_TABLES, INSERT_ORDER
from tools.ingest.verify import open_db, verify, write_report

EXPECTED = {
    "note_day": 30,
    "note_item": 32,
    "note_comment": 40,
    "milestone": 10,
    "observation": 11,
    "growth_ref": 12,
    "checkup": 1,
    "measurement": 4,
    "report_doc": 3,
}


def failed(checks):
    return {c.id for c in checks if not c.ok}


def test_counts_and_manifest(exported):
    out, gen = exported
    assert gen.manifest["tables"] == EXPECTED
    assert gen.manifest["counts"]["note_days"] == 30
    assert gen.manifest["counts"]["reports"] == 32
    assert gen.manifest["counts"]["comments"] == 40
    assert gen.manifest["date_range"] == {"min": "2023-03-02", "max": "2023-04-12"}
    on_disk = json.loads((out / MANIFEST).read_text(encoding="utf-8"))
    assert on_disk == gen.manifest
    for f in on_disk["files"]:
        assert hashlib.sha256((out / f["name"]).read_bytes()).hexdigest() == f["sha256"]
    # 원본 해시: 읽은 파일만(사진·영상 없음)
    assert on_disk["sources"] and all(len(v) == 64 for v in on_disk["sources"].values())


def test_export_is_byte_deterministic(tmp_path: Path, cfg, fixture_dir: Path):
    a, b = tmp_path / "a", tmp_path / "b"
    write_output(generate(fixture_dir, cfg), a)
    write_output(generate(fixture_dir, cfg), b)
    names = sorted(p.name for p in a.iterdir())
    assert names == sorted(p.name for p in b.iterdir()) and MANIFEST in names
    for n in names:
        assert (a / n).read_bytes() == (b / n).read_bytes(), n
    # BOM 없음, SQL 줄바꿈은 LF (본문의 CR 은 esc() 가 이미 정리)
    for n in names:
        raw = (a / n).read_bytes()
        assert not raw.startswith(b"\xef\xbb\xbf")
        assert b"\r" not in raw


def test_verify_passes_all_checks(exported, cfg, fixture_dir):
    out, _ = exported
    checks = verify(fixture_dir, out, cfg)
    assert not failed(checks), [c for c in checks if not c.ok]
    ids = {c.id for c in checks}
    assert {"F1", "F2", "F3", "I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"} <= ids
    rep = write_report(out, checks)
    assert rep["ok"] is True
    assert rep["manifest_sha256"] == hashlib.sha256((out / MANIFEST).read_bytes()).hexdigest()


def test_applied_db_matches_manifest(exported):
    out, gen = exported
    db = open_db(out, gen.manifest)
    for t, n in EXPECTED.items():
        assert db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == n
    # 비대상 테이블은 export 가 만들지 않는다(시드 외 증가 없음)
    assert db.execute("SELECT COUNT(*) FROM family_log").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM auth_attempt").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM ingest_run").fetchone()[0] == 0


def test_forbidden_tables_never_in_sql(exported):
    out, _ = exported
    for p in out.glob("*.sql"):
        text = p.read_text(encoding="utf-8")
        for t in (*FORBIDDEN_TABLES, "ingest_run"):
            assert not re.search(rf"\b(INSERT INTO|DELETE FROM|UPDATE) {t}\b", text)


def test_boundary_values(exported):
    out, gen = exported
    db = open_db(out, gen.manifest)
    # 하루 2건
    two = db.execute("SELECT date FROM note_day WHERE n_reports = 2 ORDER BY date").fetchall()
    assert len(two) == 2
    for (d,) in two:
        assert db.execute("SELECT COUNT(*) FROM note_item WHERE date=?", (d,)).fetchone()[0] == 2
    # 댓글 0 인 알림장
    assert (
        db.execute(
            "SELECT COUNT(*) FROM note_item WHERE report_id NOT IN (SELECT report_id FROM note_comment)"
        ).fetchone()[0]
        > 0
    )
    # 빈 본문
    empty = db.execute(
        "SELECT date, first_line FROM note_item JOIN note_day USING(date) WHERE body = ''"
    ).fetchall()
    assert len(empty) == 1 and empty[0][1] == ""
    # 이모지·작은따옴표·CRLF 정리
    assert db.execute("SELECT COUNT(*) FROM note_item WHERE body LIKE '%🎵😊%'").fetchone()[0] == 1
    crlf = db.execute("SELECT body FROM note_item WHERE body LIKE '첫 줄입니다.%'").fetchone()[0]
    assert "\r" not in crlf and "'ㄱ'" in crlf and crlf.endswith("끝 줄")
    # 긴 본문은 나눠 붙인 뒤 온전
    long_len = db.execute("SELECT MAX(LENGTH(body)) FROM note_item").fetchone()[0]
    assert long_len > 20_000
    sql_all = "".join(p.read_text(encoding="utf-8") for p in out.glob("*note_item*.sql"))
    assert "UPDATE note_item SET body = body ||" in sql_all
    # 역할만 저장, 방향
    roles = dict(db.execute("SELECT author_role, direction FROM note_item GROUP BY 1").fetchall())
    assert roles == {"교사": "to_home", "엄마": "to_center"}
    # 날씨 미기재는 NULL, 한국어 값
    assert db.execute("SELECT COUNT(*) FROM note_item WHERE weather IS NULL").fetchone()[0] >= 1
    assert db.execute("SELECT COUNT(*) FROM note_item WHERE weather = '맑음'").fetchone()[0] >= 1
    # 댓글 id = report_id*1000+순번, 시각은 KST 분 단위
    cid, rid, at = db.execute(
        "SELECT id, report_id, posted_at FROM note_comment ORDER BY id LIMIT 1"
    ).fetchone()
    assert cid // 1000 == rid and re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d", at)
    # 검진: UNCERTAIN 계측, 사진 키 없음, 원문 그대로
    assert db.execute(
        "SELECT read_status, condition_note FROM measurement WHERE measure='weight_kg'"
    ).fetchone() == (
        "UNCERTAIN",
        "옷을 입고 측정(합성 메모)",
    )
    assert db.execute("SELECT round_label, age_months, source_image_key FROM checkup").fetchone() == (
        "30~36개월용",
        35,
        None,
    )
    assert db.execute("SELECT sheet_percentile FROM measurement WHERE measure='bmi'").fetchone()[0] is None
    # 성장 기준표 NA -> NULL
    assert db.execute("SELECT l, m, s FROM growth_ref WHERE measure='height_cm' LIMIT 1").fetchone() == (
        None,
        None,
        None,
    )
    # 문서: 원문 보존, 제목, 빈 r2_key, verify_ok 는 export 단계에서 0
    docs = {r[0]: r for r in db.execute("SELECT slug, title, kind, r2_key, verify_ok, body FROM report_doc")}
    assert set(docs) == {"guide/01-sample-guide", "wiki/01-sample-wiki", "reports/sample-report"}
    assert docs["reports/sample-report"][1] == "합성 보고서 & 제목"
    assert docs["reports/sample-report"][2] == "html"
    assert all(d[3] == "" and d[4] == 0 for d in docs.values())


def test_age_months_from_birth(exported):
    out, gen = exported
    db = open_db(out, gen.manifest)
    assert db.execute("SELECT age_months FROM note_day WHERE date='2023-03-02'").fetchone()[0] == 37
    assert db.execute("SELECT age_months FROM note_day WHERE date='2023-04-12'").fetchone()[0] == 38


# ───────────────────────── 변조·결함 감지 ─────────────────────────
def _verify_copy(data: Path, tmp_path: Path):
    cfg = load_config(data)
    gen = generate(data, cfg)
    out = tmp_path / "o"
    write_output(gen, out)
    return verify(data, out, cfg), out, gen


def test_detects_changed_md_line(data_copy: Path, tmp_path: Path):
    md = data_copy / "notes" / "2023-03" / "2023-03-03.md"
    md.write_text(md.read_text(encoding="utf-8").replace("블록", "블럭", 1), encoding="utf-8")
    checks, _, _ = _verify_copy(data_copy, tmp_path)
    assert "I2" in failed(checks)


def test_detects_missing_md_and_count_drift(data_copy: Path, tmp_path: Path):
    (data_copy / "notes" / "2023-03" / "2023-03-06.md").unlink()
    checks, _, _ = _verify_copy(data_copy, tmp_path)
    assert {"I1", "I2"} & failed(checks)


def test_detects_observation_not_in_note(data_copy: Path, tmp_path: Path):
    p = data_copy / "tracking" / "observations.csv"
    p.write_text(p.read_text(encoding="utf-8").replace("2023-03-02", "2023-03-03", 1), encoding="utf-8")
    checks, _, _ = _verify_copy(data_copy, tmp_path)
    assert "I3" in failed(checks)


def test_detects_source_changed_after_export(data_copy: Path, tmp_path: Path):
    cfg = load_config(data_copy)
    gen = generate(data_copy, cfg)
    out = tmp_path / "o"
    write_output(gen, out)
    doc = data_copy / "guide" / "01-sample-guide.md"
    doc.write_text(doc.read_text(encoding="utf-8") + "추가\n", encoding="utf-8")
    assert "I4" in failed(verify(data_copy, out, cfg))


def test_detects_real_name_in_role(data_copy: Path, tmp_path: Path):
    p = data_copy / "source" / "synthetic_reports.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    data["reports"][0]["author"] = "홍길동"
    data["reports"][0]["author_name"] = "홍길동"  # 역할 칸에 이름이 들어가는 입력
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    checks, _, _ = _verify_copy(data_copy, tmp_path)
    assert "I5" in failed(checks)


def test_detects_tampered_sql_file(exported, cfg, fixture_dir):
    out, _ = exported
    f = next(out.glob("*note_item*.sql"))
    f.write_bytes(f.read_bytes().replace("블록".encode(), "블럭".encode(), 1))
    assert "F1" in failed(verify(fixture_dir, out, cfg))


def test_detects_forbidden_table_even_with_matching_hash(exported, cfg, fixture_dir):
    """공격자가 SQL 과 manifest 해시를 함께 고쳐도 화이트리스트가 막는다."""
    out, gen = exported
    evil = "DELETE FROM family_log;\n"
    (out / "99_evil.sql").write_bytes(evil.encode())
    gen.manifest["files"].append(
        {
            "name": "99_evil.sql",
            "sha256": hashlib.sha256(evil.encode()).hexdigest(),
            "bytes": len(evil),
            "statements": 1,
            "tables": ["family_log"],
        }
    )
    (out / MANIFEST).write_bytes(manifest_text(gen.manifest).encode())
    checks = verify(fixture_dir, out, cfg)
    assert failed(checks) == {"F2"} and "family_log" in next(c for c in checks if c.id == "F2").detail


def test_detects_duplicate_key_in_sql(exported, cfg, fixture_dir):
    out, gen = exported
    f = next(out.glob("*note_day*.sql"))
    first_line = f.read_text(encoding="utf-8").split("\n")[0]
    new = f.read_text(encoding="utf-8") + first_line + "\n"
    f.write_bytes(new.encode())
    for entry in gen.manifest["files"]:
        if entry["name"] == f.name:
            entry["sha256"] = hashlib.sha256(new.encode()).hexdigest()
    (out / MANIFEST).write_bytes(manifest_text(gen.manifest).encode())
    checks = verify(fixture_dir, out, cfg)
    assert "F3" in failed(checks) and "UNIQUE" in next(c for c in checks if c.id == "F3").detail


def test_missing_manifest(tmp_path: Path, cfg, fixture_dir):
    (tmp_path / "empty").mkdir()
    assert failed(verify(fixture_dir, tmp_path / "empty", cfg)) == {"F1"}


# ───────────────────────── 입력 오류: 메시지에 자료 내용이 없다 ─────────────────────────
def _edit_reports(data: Path, fn) -> None:
    p = data / "source" / "synthetic_reports.json"
    obj = json.loads(p.read_text(encoding="utf-8"))
    fn(obj)
    p.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda o: o["reports"][1].__setitem__("id", o["reports"][0]["id"]),
        lambda o: o["reports"][0]["comments"].append(
            {"t": "2023-03-02T01:00:00Z", "who": "grandma", "name": "x", "txt": "y"}
        ),
        lambda o: o["reports"][0].__setitem__("date", "2023-13-40"),
        lambda o: o["reports"][0].pop("content"),
        lambda o: o["meta"].pop("birth"),
    ],
)
def test_bad_reports_raise_without_content(data_copy: Path, mutate):
    _edit_reports(data_copy, mutate)
    with pytest.raises(SourceError) as e:
        build_all(data_copy, load_config(data_copy))
    msg = str(e.value)
    assert "블록" not in msg and "교사A" not in msg and "해바라기" not in msg


def test_missing_source_files(data_copy: Path):
    (data_copy / "evidence" / "milestones.csv").unlink()
    with pytest.raises(SourceError):
        build_all(data_copy, load_config(data_copy))


def test_observation_with_unknown_milestone(data_copy: Path):
    p = data_copy / "tracking" / "observations.csv"
    p.write_text(p.read_text(encoding="utf-8").replace("SYN-12M-GM-01", "NOPE", 1), encoding="utf-8")
    with pytest.raises(SourceError):
        build_all(data_copy, load_config(data_copy))


def test_checkup_unknown_status_or_item(data_copy: Path):
    p = data_copy / "checkups" / "2022-12-20_synthetic.csv"
    base = p.read_text(encoding="utf-8")
    p.write_text(base.replace("UNCERTAIN", "MAYBE"), encoding="utf-8")
    with pytest.raises(SourceError):
        build_all(data_copy, load_config(data_copy))
    p.write_text(base.replace("체질량지수(BMI)", "허리둘레"), encoding="utf-8")
    with pytest.raises(SourceError):
        build_all(data_copy, load_config(data_copy))


def test_one_source_json_required(data_copy: Path):
    (data_copy / "source" / "second_reports.json").write_text("{}", encoding="utf-8")
    cfg = load_config(data_copy)
    cfg = type(cfg)(**{**cfg.__dict__, "reports_json": "source/*.json"})
    with pytest.raises(SourceError):
        load_reports(Sources(data_copy), cfg)


# ───────────────────────── 설정·경로 안전 ─────────────────────────
@pytest.mark.parametrize("bad", ["../x.json", "/abs/x.json", "C:/x.json", "a\\b.json", ""])
def test_config_rejects_unsafe_paths(bad: str):
    with pytest.raises(ConfigError):
        parse_config({"reports_json": bad})


def test_config_rejects_unknown_keys_and_bad_docs():
    with pytest.raises(ConfigError):
        parse_config({"nope": 1})
    with pytest.raises(ConfigError):
        parse_config({"docs": [{"dir": "a", "glob": "*.md", "kind": "pdf"}]})
    assert parse_config({}).notes_dir == "alrimjang"  # 기본 구조


def test_config_precedence(tmp_path: Path, monkeypatch):
    (tmp_path / "ingest.config.json").write_text('{"notes_dir": "n1"}', encoding="utf-8")
    assert load_config(tmp_path).notes_dir == "n1"
    other = tmp_path / "o.json"
    other.write_text('{"notes_dir": "n2"}', encoding="utf-8")
    monkeypatch.setenv("INGEST_CONFIG", str(other))
    assert load_config(tmp_path).notes_dir == "n2"
    explicit = tmp_path / "e.json"
    explicit.write_text('{"notes_dir": "n3"}', encoding="utf-8")
    assert load_config(tmp_path, explicit).notes_dir == "n3"
    explicit.write_text("[]", encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(tmp_path, explicit)


def test_glob_cannot_escape_data_dir(tmp_path: Path):
    data = tmp_path / "data"
    data.mkdir()
    (tmp_path / "secret.csv").write_text("a", encoding="utf-8")
    src = Sources(data)
    with pytest.raises(SourceError):
        src.read(tmp_path / "secret.csv")
    assert src.glob("*.csv") == []


def test_out_dir_safety(tmp_path: Path, fixture_dir: Path):
    with pytest.raises(ExportError):
        assert_safe_out(REPO_ROOT / "out", fixture_dir)
    with pytest.raises(ExportError):
        assert_safe_out(tmp_path / "data" / "out", tmp_path / "data")
    assert assert_safe_out(tmp_path / "ok", fixture_dir) == (tmp_path / "ok").resolve()


def test_write_output_refuses_nonempty_without_force(exported, tmp_path: Path):
    out, gen = exported
    with pytest.raises(ExportError):
        write_output(gen, out)
    write_output(gen, out, force=True)
    (out / "stray.txt").write_text("x", encoding="utf-8")
    with pytest.raises(ExportError):
        write_output(gen, out, force=True)


def test_sqlite_is_the_only_db_dependency():
    # 런타임 의존성 없음 확인(표준 라이브러리만): requirements.txt 에 패키지 줄이 없다
    lines = (REPO_ROOT / "tools/ingest/requirements.txt").read_text(encoding="utf-8").splitlines()
    assert [ln for ln in lines if ln.strip() and not ln.startswith("#")] == []
    assert sqlite3.sqlite_version_info >= (3, 35)  # ALTER TABLE ADD COLUMN·RETURNING 등 최소 요건
    assert INSERT_ORDER[0] == "note_day"
