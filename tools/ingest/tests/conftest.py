from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from tools.ingest.config import load_config
from tools.ingest.export import MANIFEST, REPO_ROOT, Generated, generate, write_output
from tools.ingest.sqlgen import INSERT_ORDER
from tools.ingest.verify import verify, write_report
from tools.ingest.wrangler import RunnerError

FIXTURE = REPO_ROOT / "fixtures" / "data_dir"
MIGRATIONS = sorted((REPO_ROOT / "migrations").glob("*.sql"))


class SqliteRunner:
    """wrangler 대신 파일 SQLite 에 적용하는 테스트용 Runner. D1 처럼 외래 키를 켠다."""

    label = "test:sqlite"

    def __init__(self, path: Path, fail_on_call: int | None = None, record_migrations: bool = True) -> None:
        self.path = path
        self.fail_on_call = fail_on_call
        self.calls = 0
        self.trace: list[str] = []
        self.after_file: list = []  # 각 exec_file 뒤에 실행할 함수(결함 주입용)
        conn = self._conn()
        for m in MIGRATIONS:
            conn.executescript(m.read_text(encoding="utf-8"))
        if record_migrations:  # wrangler d1 migrations apply 가 남기는 표와 같은 모양
            conn.execute(
                "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, "
                "applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)"
            )
            conn.executemany("INSERT INTO d1_migrations (name) VALUES (?)", [(m.name,) for m in MIGRATIONS])
            conn.commit()
        conn.close()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.execute("PRAGMA foreign_keys = ON")
        # D1 한도 흥내: UNION ALL 항 수 제한(실제 wrangler --local 에서 'too many terms in compound SELECT' 로 확인)
        conn.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, 5)
        conn.row_factory = sqlite3.Row
        conn.set_trace_callback(self.trace.append)
        return conn

    def exec_file(self, path: Path) -> None:
        self.calls += 1
        if self.fail_on_call is not None and self.calls == self.fail_on_call:
            raise RuntimeError("주입된 실패")
        conn = self._conn()
        conn.executescript(path.read_bytes().decode("utf-8"))
        conn.close()
        for fn in self.after_file:
            fn(self)

    def query(self, sql: str) -> list[dict]:
        conn = self._conn()
        try:
            rows = [dict(r) for r in conn.execute(sql).fetchall()]
        except sqlite3.Error as e:  # 실제 WranglerRunner 처럼 실행 실패는 RunnerError
            raise RunnerError(f"쿼리 실패: {type(e).__name__}") from e
        finally:
            conn.close()
        return rows

    def run(self, sql: str, *params: object) -> None:
        conn = self._conn()
        conn.execute(sql, params)
        conn.commit()
        conn.close()

    def dump(self) -> dict[str, list[tuple]]:
        out = {}
        for t in INSERT_ORDER:
            out[t] = [tuple(r.values()) for r in self.query(f"SELECT * FROM {t} ORDER BY 1")]
        return out


@pytest.fixture
def fixture_dir() -> Path:
    return FIXTURE


@pytest.fixture
def cfg():
    return load_config(FIXTURE)


@pytest.fixture
def data_copy(tmp_path: Path) -> Path:
    """고칠 수 있는 fixture 복사본."""
    dst = tmp_path / "data"
    shutil.copytree(FIXTURE, dst)
    return dst


PASS_VERIFIER = "raise SystemExit(0)\n"
FAIL_VERIFIER = "raise SystemExit(1)\n"


def add_fake_verifiers(data_dir: Path, results: dict[str, str]) -> None:
    """계층 이름 -> 스크립트 내용. 합성 가짜 검증기(종료 코드만 다르다)."""
    from tools.ingest.layers import LAYER_VERIFIERS

    for layer, body in results.items():
        p = data_dir / LAYER_VERIFIERS[layer]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")


@pytest.fixture
def verified_data(tmp_path: Path) -> Path:
    """fixture 복사본 + 통과하는 가짜 검증기(guide·wiki·tracking·evidence). reports/ 는 계층 검증기가 없다."""
    dst = tmp_path / "data_v"
    shutil.copytree(FIXTURE, dst)
    add_fake_verifiers(dst, dict.fromkeys(("guide", "wiki", "tracking", "evidence"), PASS_VERIFIER))
    return dst


@pytest.fixture
def exported(tmp_path: Path, cfg, verified_data: Path) -> tuple[Path, Generated]:
    gen = generate(verified_data, cfg)
    out = tmp_path / "out"
    write_output(gen, out)
    return out, gen


@pytest.fixture
def verified(exported, cfg, verified_data: Path) -> Path:
    out, _ = exported
    checks = verify(verified_data, out, cfg)
    assert all(c.ok for c in checks), [c for c in checks if not c.ok]
    write_report(out, checks)
    return out


__all__ = ["MANIFEST", "SqliteRunner"]
