"""upload: 멱등, family_log 불변, 실패 경로(ingest_run=failed), 미검증 거부, status."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from tools.ingest.export import MANIFEST
from tools.ingest.sqlgen import FORBIDDEN_TABLES
from tools.ingest.upload import UploadError, load_checked, status, upload
from tools.ingest.verify import VERIFY
from tools.ingest.wrangler import RunnerError, sanitize_error

from .conftest import SqliteRunner
from .test_pipeline import EXPECTED

NOW = None


def _seed_family(r: SqliteRunner) -> None:
    r.run(
        "INSERT INTO family_log (id, type, occurred_on, recorder, payload, note, created_at, updated_at, deleted_at, device_id) "
        "VALUES ('01', 'meal', '2023-03-02', '엄마', '{}', '메모', '2023-03-02T00:00:00Z', '2023-03-02T00:00:00Z', NULL, 'd1')"
    )
    r.run("INSERT INTO auth_attempt (ip_hash, at, ok) VALUES ('h', '2023-03-02T00:00:00Z', 1)")


def _protected(r: SqliteRunner) -> dict:
    return {
        t: [tuple(x.values()) for x in r.query(f"SELECT * FROM {t} ORDER BY 1")]
        for t in ("family_log", "auth_attempt", "app_setting", "log_type")
    }


def _counts(r: SqliteRunner) -> dict[str, int]:
    return {t: r.query(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"] for t in EXPECTED}


def test_upload_applies_and_records_run(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite")
    _seed_family(r)
    before = _protected(r)
    r.trace.clear()
    logs: list[str] = []
    res = upload(verified, r, log=logs.append)
    executed = list(r.trace)  # upload 중 실행된 모든 SQL
    assert _counts(r) == EXPECTED
    assert res["run_id"] == 1
    run = r.query("SELECT * FROM ingest_run")[0]
    assert run["status"] == "ok" and run["finished_at"].endswith("Z") and run["source_commit"]
    assert json.loads(run["counts_json"])["reports"] == 32
    assert json.loads(run["verify_json"])["ok"] is True
    # /api/health 의 lastIngestAt 쿼리와 같은 조건
    assert r.query("SELECT finished_at FROM ingest_run WHERE status='ok' ORDER BY id DESC LIMIT 1")
    # I4 통과 + 그 문서 계층의 검증기가 통과한 문서만 verify_ok = 1 (R1-7). reports/ 는 검증기 없음 -> 0
    got = {x["slug"]: x["verify_ok"] for x in r.query("SELECT slug, verify_ok FROM report_doc")}
    assert got and {1, 0} == set(got.values())
    assert {x["kind"] for x in r.query("SELECT kind FROM report_doc WHERE verify_ok = 1")} == {"markdown"}
    assert {x["kind"] for x in r.query("SELECT kind FROM report_doc WHERE verify_ok = 0")} == {"html"}
    # 긴 본문이 나눠 붙은 뒤에도 온전
    assert r.query("SELECT MAX(LENGTH(body)) AS n FROM note_item")[0]["n"] > 20_000
    # family_log 등 비대상 테이블 불변 + SQL 에 한 번도 등장하지 않음
    assert _protected(r) == before
    assert executed and [s for s in executed if any(t in s for t in FORBIDDEN_TABLES)] == []


def test_upload_is_idempotent(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite")
    upload(verified, r, log=lambda _: None)
    first = r.dump()
    upload(verified, r, log=lambda _: None)
    assert r.dump() == first
    runs = r.query("SELECT id, status FROM ingest_run ORDER BY id")
    assert [x["status"] for x in runs] == ["ok", "ok"] and runs[1]["id"] == 2


def test_upload_replaces_stale_rows(verified: Path, tmp_path: Path):
    """대상 테이블은 교체: 이전 적재에만 있던 행은 사라지고 family_log 는 남는다."""
    r = SqliteRunner(tmp_path / "d1.sqlite")
    _seed_family(r)
    upload(verified, r, log=lambda _: None)
    r.run(
        "INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) VALUES ('OLD', 'd', 1, 'm', 's')"
    )
    upload(verified, r, log=lambda _: None)
    assert r.query("SELECT COUNT(*) AS n FROM milestone WHERE evidence_id='OLD'")[0]["n"] == 0
    assert r.query("SELECT COUNT(*) AS n FROM family_log")[0]["n"] == 1


@pytest.mark.parametrize("fail_call", [2, 5, 11])
def test_failure_marks_run_failed_and_retry_recovers(verified: Path, tmp_path: Path, fail_call: int):
    # 호출 1 = ingest_run 시작, 2.. = 파일 적용, 마지막 앞 = 마무리
    r = SqliteRunner(tmp_path / "d1.sqlite", fail_on_call=fail_call)
    _seed_family(r)
    before = _protected(r)
    with pytest.raises(UploadError):
        upload(verified, r, log=lambda _: None)
    runs = r.query("SELECT status FROM ingest_run")
    assert [x["status"] for x in runs] == ["failed"]
    assert not r.query("SELECT 1 FROM ingest_run WHERE status = 'ok'")  # lastIngestAt 은 바뀌지 않는다
    assert _protected(r) == before
    # 같은 입력으로 다시 실행하면 복구(교체 방식)
    r.fail_on_call = None
    upload(verified, r, log=lambda _: None)
    assert _counts(r) == EXPECTED
    assert [x["status"] for x in r.query("SELECT status FROM ingest_run ORDER BY id")] == ["failed", "ok"]


def test_count_mismatch_after_load_fails(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite")
    state = {"n": 0}

    def drop_one(runner: SqliteRunner) -> None:
        state["n"] += 1
        if state["n"] == 10:  # 마지막 데이터 파일 직후
            runner.run("DELETE FROM note_comment WHERE id = (SELECT MIN(id) FROM note_comment)")

    r.after_file.append(drop_one)
    with pytest.raises(UploadError, match="건수 불일치"):
        upload(verified, r, log=lambda _: None)
    assert r.query("SELECT status FROM ingest_run")[0]["status"] == "failed"
    assert {x["verify_ok"] for x in r.query("SELECT verify_ok FROM report_doc")} == {0}


def test_text_length_mismatch_fails(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite")
    state = {"n": 0}

    def trim(runner: SqliteRunner) -> None:
        state["n"] += 1
        if state["n"] == 10:
            runner.run(
                "UPDATE note_item SET body = substr(body, 1, length(body) - 1) WHERE length(body) > 20000"
            )

    r.after_file.append(trim)
    with pytest.raises(UploadError, match="글자 수"):
        upload(verified, r, log=lambda _: None)


def test_refuses_without_verify(exported, tmp_path: Path):
    out, _ = exported
    r = SqliteRunner(tmp_path / "d1.sqlite")
    with pytest.raises(UploadError, match="verify"):
        upload(out, r, log=lambda _: None)
    assert r.query("SELECT COUNT(*) AS n FROM ingest_run")[0]["n"] == 0


def test_refuses_after_tampering(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite")
    f = next(verified.glob("*note_item*.sql"))
    f.write_bytes(f.read_bytes() + b"DELETE FROM family_log;\n")
    with pytest.raises(UploadError):
        upload(verified, r, log=lambda _: None)
    assert r.query("SELECT COUNT(*) AS n FROM ingest_run")[0]["n"] == 0


def test_refuses_when_manifest_changed_after_verify(verified: Path, tmp_path: Path):
    m = json.loads((verified / MANIFEST).read_bytes())
    m["source_commit"] = "tampered"
    (verified / MANIFEST).write_bytes(json.dumps(m).encode())
    with pytest.raises(UploadError, match="verify"):
        load_checked(verified)


def test_refuses_failed_verify_report(verified: Path):
    rep = json.loads((verified / VERIFY).read_bytes())
    rep["ok"] = False
    (verified / VERIFY).write_bytes(json.dumps(rep).encode())
    with pytest.raises(UploadError):
        load_checked(verified)


def test_refuses_foreign_sql_even_if_hashes_match(verified: Path):
    evil = b"DELETE FROM app_setting;\n"
    f = next(verified.glob("*note_item*.sql"))
    f.write_bytes(evil)
    m = json.loads((verified / MANIFEST).read_bytes())
    for e in m["files"]:
        if e["name"] == f.name:
            e["sha256"] = hashlib.sha256(evil).hexdigest()
    mb = json.dumps(m, sort_keys=True).encode()
    (verified / MANIFEST).write_bytes(mb)
    rep = json.loads((verified / VERIFY).read_bytes())
    rep["manifest_sha256"] = hashlib.sha256(mb).hexdigest()
    (verified / VERIFY).write_bytes(json.dumps(rep).encode())
    with pytest.raises(UploadError, match="허용되지"):
        load_checked(verified)


def test_missing_migration_gives_clear_error(verified: Path, tmp_path: Path):
    class NoTable(SqliteRunner):
        def query(self, sql: str) -> list[dict]:
            if "ingest_run" in sql:
                raise RunnerError("no such table: ingest_run")
            return super().query(sql)

    with pytest.raises(UploadError, match="마이그레이션"):
        upload(verified, NoTable(tmp_path / "d1.sqlite"), log=lambda _: None)


def test_status_reports_match_and_mismatch(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite")
    manifest = load_checked(verified)
    assert status(r, manifest)["last_run"] is None
    upload(verified, r, log=lambda _: None)
    s = status(r, manifest)
    assert s["matches_manifest"] is True and s["last_run"]["status"] == "ok" and s["tables"] == EXPECTED
    r.run("DELETE FROM growth_ref WHERE growth_id = (SELECT MIN(growth_id) FROM growth_ref)")
    s = status(r, manifest)
    assert s["matches_manifest"] is False and s["mismatch"] == ["growth_ref: 11 != 12"]
    assert "matches_manifest" not in status(r, None)


def test_sanitize_error_hides_sql_fragments():
    text = "stuff\nD1_ERROR: near 'secret body text': syntax error\nmore \"quoted data\" lines\nError: failed at 'x'"
    out = sanitize_error(text)
    assert "secret body text" not in out and "quoted data" not in out and "D1_ERROR" in out
    assert sanitize_error("nothing") == "상세 없음"
    json_err = '{\n  "error": {\n    "text": "too many terms in compound SELECT: SQLITE_ERROR"\n  }\n}'
    assert "too many terms in compound SELECT" in sanitize_error(json_err)
    leaky = '"text": "near \'secret body\': syntax error: SQLITE_ERROR"'
    assert "secret body" not in sanitize_error(leaky)


def test_upload_stops_before_touching_db_when_migration_missing(verified: Path, tmp_path: Path):
    """0007 이 d1_migrations 에 없으면 DB 를 건드리지 않고 안내와 함께 멈춘다(ingest_run 도 남기지 않는다)."""
    r = SqliteRunner(tmp_path / "d1.sqlite")
    r.run("DELETE FROM d1_migrations WHERE name LIKE '0007%'")
    r.trace.clear()
    with pytest.raises(UploadError, match=r"0007_report_doc_summary\.sql.*db:migrate"):
        upload(verified, r, log=lambda _: None)
    assert r.query("SELECT COUNT(*) AS n FROM ingest_run")[0]["n"] == 0
    assert not [s for s in r.trace if "INSERT INTO" in s or "DELETE FROM" in s]


def test_upload_stops_when_migration_table_is_absent(verified: Path, tmp_path: Path):
    r = SqliteRunner(tmp_path / "d1.sqlite", record_migrations=False)
    with pytest.raises(UploadError, match=r"d1_migrations.*db:migrate"):
        upload(verified, r, log=lambda _: None)


def test_upload_stops_when_body_column_is_missing(verified: Path, tmp_path: Path):
    """표시는 있는데 실제 칸이 없는 DB(수동 작업)도 막는다."""
    r = SqliteRunner(tmp_path / "d1.sqlite")
    r.run("ALTER TABLE report_doc DROP COLUMN body")
    with pytest.raises(UploadError, match=r"report_doc\.body"):
        upload(verified, r, log=lambda _: None)
    assert r.query("SELECT COUNT(*) AS n FROM ingest_run")[0]["n"] == 0
