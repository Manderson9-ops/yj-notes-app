"""backup-extract.py 테스트: 합성 자료만 쓴다."""

import importlib.util
import sqlite3
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "backup_extract", Path(__file__).with_name("backup-extract.py")
)
assert _spec and _spec.loader
backup_extract = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backup_extract)

SCHEMA = """
CREATE TABLE family_log (id TEXT PRIMARY KEY, note TEXT);
CREATE TABLE family_log_history (id TEXT PRIMARY KEY, log_id TEXT);
CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO family_log VALUES ('l1', 'it''s synthetic');
INSERT INTO app_setting VALUES ('child_sex', 'x');
INSERT INTO app_setting VALUES ('session_epoch', '7');
INSERT INTO app_setting VALUES ('last_global_lock_at', '2030-01-01T00:00:00.000Z');
"""


def run(tmp_path, capsys, schema=SCHEMA):
    src = tmp_path / "b.sql"
    out = tmp_path / "o.sql"
    src.write_text(schema, encoding="utf-8")
    code = backup_extract.main(str(src), str(out))
    return code, out.read_text(encoding="utf-8"), capsys.readouterr().out


def test_skips_session_epoch_and_last_lock(tmp_path, capsys):
    code, sql, printed = run(tmp_path, capsys)
    assert code == 0
    assert "session_epoch" not in sql
    assert "last_global_lock_at" not in sql
    assert "child_sex" in sql
    assert "session_epoch" in printed and "last_global_lock_at" in printed


def test_output_is_valid_and_quotes_survive(tmp_path, capsys):
    _, sql, _ = run(tmp_path, capsys)
    con = sqlite3.connect(":memory:")
    con.executescript(SCHEMA.split("INSERT")[0])
    con.executescript(sql)
    assert con.execute("SELECT note FROM family_log").fetchone() == ("it's synthetic",)
    assert con.execute("SELECT COUNT(*) FROM app_setting").fetchone() == (1,)


def test_no_skip_message_when_nothing_skipped(tmp_path, capsys):
    schema = SCHEMA.split("INSERT INTO app_setting")[0] + "INSERT INTO app_setting VALUES ('a','b');"
    code, sql, printed = run(tmp_path, capsys, schema)
    assert code == 0
    assert "제외" not in printed
    assert "'a'" in sql


def test_oversized_row_fails(tmp_path, capsys):
    big = "x" * (backup_extract.MAX_STMT + 10)
    schema = SCHEMA + f"INSERT INTO family_log VALUES ('big', '{big}');"
    src = tmp_path / "b.sql"
    src.write_text(schema, encoding="utf-8")
    assert backup_extract.main(str(src), str(tmp_path / "o.sql")) == 2
