from __future__ import annotations

import sqlite3

import pytest

from tools.ingest.sqlgen import (
    CHUNK_BYTES,
    FORBIDDEN_TABLES,
    INSERT_ORDER,
    MAX_ROW_BYTES,
    SPEC_BY_NAME,
    SqlError,
    delete_statements,
    render_parts,
    row_statements,
    split_statements,
    split_text,
    sql_literal,
    validate_sql,
)

from .conftest import MIGRATIONS


def test_literals():
    assert sql_literal(None) == "NULL"
    assert sql_literal(True) == "1"
    assert sql_literal(7) == "7"
    assert sql_literal(13.2) == "13.2"
    assert sql_literal("it's") == "'it''s'"
    assert sql_literal("😊\n한글") == "'😊\n한글'"
    for bad in (float("nan"), float("inf")):
        with pytest.raises(SqlError):
            sql_literal(bad)
    with pytest.raises(SqlError):
        sql_literal("a\x00b")
    with pytest.raises(SqlError):
        sql_literal("\ud800")  # 외톨이 서로게이트


def test_split_text_is_lossless_and_bounded():
    text = "가" * 1000 + "😊" * 500 + "'" * 10
    parts = split_text(text, 300)
    assert "".join(parts) == text
    assert all(len(p.encode()) <= 300 for p in parts)
    assert split_text("짧음", 300) == ["짧음"]


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    for m in MIGRATIONS:
        conn.executescript(m.read_text(encoding="utf-8"))
    return conn


def test_long_value_is_chunked_and_reassembles():
    body = ("긴 본문 줄입니다 😊 it's\n" * 4000).strip()
    assert len(body.encode()) > CHUNK_BYTES * 2
    spec = SPEC_BY_NAME["note_item"]
    row = {
        "report_id": 1,
        "date": "2023-01-02",
        "author_role": "교사",
        "direction": "to_home",
        "weather": None,
        "posted_at": "2023-01-02 10:00",
        "body": body,
    }
    stmts = row_statements(spec, row)
    assert len(stmts) >= 3 and stmts[0].startswith("INSERT INTO note_item")
    assert all(len(s.encode()) < 100_000 for s in stmts)  # D1 문장 한도
    db = _db()
    db.execute("INSERT INTO note_day VALUES ('2023-01-02','반',36,1,0,0,'')")
    for s in stmts:
        validate_sql(s)
        db.execute(s)
    assert db.execute("SELECT body FROM note_item WHERE report_id=1").fetchone()[0] == body


def test_render_parts_limits():
    stmts = [f"DELETE FROM t{i};" for i in range(10)]
    parts = render_parts(stmts, max_bytes=10_000, max_statements=3)
    assert len(parts) == 4 and "".join(parts).count("\n") == 10


def test_split_statements_respects_quotes():
    sql = "INSERT INTO note_day (date) VALUES ('a;b''c');\nDELETE FROM note_day;\n"
    assert split_statements(sql) == [
        "INSERT INTO note_day (date) VALUES ('a;b''c');",
        "DELETE FROM note_day;",
    ]
    for bad in (
        "DELETE FROM note_day",
        "SELECT 'x",
        "DELETE FROM note_day; -- c\n",
        "/* c */ DELETE FROM note_day;",
    ):
        with pytest.raises(SqlError):
            split_statements(bad)


def test_generated_delete_statements_validate():
    ops = validate_sql("\n".join(delete_statements()) + "\n")
    assert [t for _, t in ops] == list(reversed(INSERT_ORDER))


@pytest.mark.parametrize("table", (*FORBIDDEN_TABLES, "ingest_run", "sqlite_master", "migrations"))
def test_whitelist_rejects_other_tables(table: str):
    for sql in (
        f"DELETE FROM {table};",
        f"INSERT INTO {table} (a) VALUES (1);",
        f"UPDATE {table} SET a = a || 'x' WHERE id = 1;",
    ):
        with pytest.raises(SqlError):
            validate_sql(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE note_day;",
        "DELETE FROM note_day WHERE date = '2023-01-01';",
        "INSERT INTO note_day (date) VALUES (1); DELETE FROM family_log;",
        "INSERT INTO note_day (date, class_name) VALUES ('a', 'b');",  # 칸 목록이 정의와 다름
        "INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) "
        "VALUES (1, (SELECT 1), 1, 1, 1, 1, 'x');",
        "UPDATE note_item SET body = date || 'x' WHERE report_id = 1;",
        "UPDATE note_item SET body = body || 'x' WHERE date = '2023-01-01';",  # pk 가 아님
        "UPDATE report_doc SET verify_ok = 1;",  # 마무리 문장은 upload 만 허용
        "PRAGMA foreign_keys = OFF;",
    ],
)
def test_whitelist_rejects_forms(sql: str):
    with pytest.raises(SqlError):
        validate_sql(sql)


def test_finalize_statement_only_when_allowed():
    assert validate_sql("UPDATE report_doc SET verify_ok = 1;", allow_finalize=True) == [
        ("UPDATE", "report_doc")
    ]


@pytest.mark.parametrize("token", ["BEGIN TRANSACTION", "COMMIT;"])
def test_values_with_wrangler_stripped_tokens_stop_with_a_clear_error(token):
    """로컬 wrangler 가 따옴표 안에서도 지우는 글자: 값에 있으면 조용히 바뀌지 않고 멈춘다."""
    secret = f"앞글 {token} 뒷글"
    with pytest.raises(SqlError) as e:
        sql_literal(secret)
    assert token in str(e.value)  # 어떤 글자 때문인지는 알린다
    assert "앞글" not in str(e.value)  # 값 내용은 새지 않는다
    spec = SPEC_BY_NAME["note_item"]
    row = dict.fromkeys(spec.columns, 1)
    row["body"] = secret
    with pytest.raises(SqlError, match=r"note_item\.body"):
        row_statements(spec, row)


def test_tokens_split_across_chunks_or_other_case_are_not_false_positives():
    # wrangler 는 대소문자를 가리고 파일 안 연속 글자만 지우므로, 아래는 안전하다
    assert sql_literal("begin transaction commit") == "'begin transaction commit'"
    assert sql_literal("COMMIT 하고; 끝") == "'COMMIT 하고; 끝'"


def test_validate_rejects_files_that_contain_the_tokens():
    ok = "DELETE FROM note_day;\n"
    assert validate_sql(ok) == [("DELETE", "note_day")]
    for token in ("BEGIN TRANSACTION", "COMMIT;"):
        with pytest.raises(SqlError, match="SQL 파일"):
            validate_sql(ok + f"-- {token}\n")


def _doc_row(body: str) -> dict:
    return {
        "slug": "s",
        "title": "t",
        "kind": "report",
        "r2_key": None,
        "generated_at": None,
        "source_commit": "c",
        "verify_ok": 0,
        "sha256": "x",
        "body": body,
    }


def test_row_size_guard_rejects_oversized_report_body():
    """R1-5: 행(문자열 칸 합계)이 1,900,000 바이트를 넘으면 명확한 오류. 값 내용은 메시지에 없다."""
    secret_marker = "뷁"  # 3바이트 문자(메시지에 쓰이지 않는 글자)
    body = secret_marker * (MAX_ROW_BYTES // 3 + 10)
    with pytest.raises(SqlError) as e:
        row_statements(SPEC_BY_NAME["report_doc"], _doc_row(body))
    msg = str(e.value)
    assert "report_doc.body" in msg and "2MB" in msg
    assert secret_marker not in msg


def test_row_size_guard_allows_just_under_limit_and_counts_utf8_bytes():
    spec = SPEC_BY_NAME["report_doc"]
    ok = row_statements(spec, _doc_row("a" * (MAX_ROW_BYTES - 100)))
    assert len(ok) > 1  # 조각으로 나뉘어 적재된다
    # 글자 수로는 한도 이하지만 UTF-8 바이트로는 초과
    with pytest.raises(SqlError):
        row_statements(spec, _doc_row("한" * (MAX_ROW_BYTES // 3 + 1)))
