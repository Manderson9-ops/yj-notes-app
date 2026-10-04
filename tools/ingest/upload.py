"""upload: 검증을 통과한 export 결과를 D1 에 적용한다(--local 또는 --remote).

순서(docs/07): ingest_run('running') -> 삭제 -> 테이블별 INSERT -> 건수·글자 수 재확인 -> verify_ok 올림 -> ingest_run('ok').
어디서든 실패하면 ingest_run 을 'failed' 로 남기고 멈춘다(복구는 같은 입력으로 다시 upload — 대상 테이블 전체 교체라 멱등 —
또는 D1 Time Travel, docs/09). family_log 등 비대상 테이블은 문장 검사로 어떤 경우에도 건드리지 않는다.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from .export import MANIFEST, VERIFY
from .sqlgen import INSERT_ORDER, TEXT_COLUMNS, SqlError, sql_literal, validate_sql
from .wrangler import Runner, RunnerError


class UploadError(RuntimeError):
    pass


# 적재가 기대는 마이그레이션(문서 원문 body 칸 0004 + 목록 설명 summary 칸 0007). 더 새 마이그레이션은 이 이름이 적용된 뒤에만 있을 수 있다.
REQUIRED_MIGRATION = "0007_report_doc_summary.sql"


def check_migrations(runner: Runner) -> None:
    """적재 전에 대상 DB 에 필요한 마이그레이션이 적용됐는지 본다. 아니면 DB 를 건드리기 전에 멈춘다."""
    hint = "먼저 `npm run db:migrate:local`(로컬) 또는 `npm run db:migrate:prod`(운영)을 실행하세요"
    try:
        applied = {str(r["name"]) for r in runner.query("SELECT name FROM d1_migrations")}
    except (RunnerError, KeyError) as e:
        raise UploadError(
            f"대상 DB 에서 적용된 마이그레이션 목록(d1_migrations)을 읽지 못했습니다. {hint}"
        ) from e
    if REQUIRED_MIGRATION not in applied:
        raise UploadError(f"마이그레이션 {REQUIRED_MIGRATION} 이(가) 대상 DB 에 적용되지 않았습니다. {hint}")
    try:  # 표시만이 아니라 실제 칸이 있는지도 본다(수동으로 만든 DB 대비)
        runner.query("SELECT body, summary FROM report_doc LIMIT 0")
    except RunnerError as e:
        raise UploadError(f"report_doc.body/summary 칸이 없습니다. {hint}") from e


def _iso(now: datetime | None) -> str:
    return (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")


def counts_sql() -> str:
    # D1 은 UNION ALL 항이 몇 개만 허용(too many terms in compound SELECT) -> 한 행의 스칼라 하위 쿼리로 한다
    cols = [f'(SELECT COUNT(*) FROM {t}) AS "{t}"' for t in INSERT_ORDER]
    cols += [f'(SELECT COALESCE(SUM(LENGTH({c})), 0) FROM {t}) AS "{t}.{c}"' for t, c in TEXT_COLUMNS]
    return "SELECT " + ", ".join(cols)


def remote_counts(runner: Runner) -> dict[str, int]:
    rows = runner.query(counts_sql())
    if len(rows) != 1:
        raise UploadError("건수 조회 결과가 예상과 다릅니다")
    return {str(k): int(v) for k, v in rows[0].items()}


def load_checked(out_dir: Path) -> dict:  # type: ignore[type-arg]
    """manifest·verify.json·SQL 파일 해시와 문장 형태를 다시 검사하고 manifest 를 돌려준다."""
    mpath, vpath = out_dir / MANIFEST, out_dir / VERIFY
    if not mpath.is_file() or not vpath.is_file():
        raise UploadError("manifest.json/verify.json 이 없습니다. export -> verify 를 먼저 실행하세요")
    mbytes = mpath.read_bytes()
    manifest = json.loads(mbytes)
    rep = json.loads(vpath.read_bytes())
    if not rep.get("ok") or rep.get("manifest_sha256") != hashlib.sha256(mbytes).hexdigest():
        raise UploadError(
            "verify 가 통과하지 않았거나 export 이후 manifest 가 바뀌었습니다. verify 를 다시 실행하세요"
        )
    for f in manifest["files"]:
        p = out_dir / f["name"]
        data = p.read_bytes() if p.is_file() else b""
        if hashlib.sha256(data).hexdigest() != f["sha256"]:
            raise UploadError(f"SQL 파일이 manifest 와 다릅니다: {f['name']}")
        try:
            validate_sql(data.decode("utf-8"))
        except (SqlError, UnicodeDecodeError) as e:
            raise UploadError(f"{f['name']}: {e}") from e
    return manifest


def _compare(manifest: dict, got: dict[str, int]) -> list[str]:  # type: ignore[type-arg]
    bad = [
        f"{t}: {got.get(t)} != {manifest['tables'][t]}"
        for t in INSERT_ORDER
        if got.get(t) != manifest["tables"][t]
    ]
    for t, c in TEXT_COLUMNS:
        key = f"{t}.{c}"
        if got.get(key) != manifest["text_chars"][key]:
            bad.append(f"{key} 글자 수 불일치")
    return bad


def upload(
    out_dir: Path,
    runner: Runner,
    *,
    now: datetime | None = None,
    log: Callable[[str], None] = print,
) -> dict:  # type: ignore[type-arg]
    manifest = load_checked(out_dir)
    check_migrations(runner)
    rep = json.loads((out_dir / VERIFY).read_bytes())
    started = _iso(now)
    try:
        run_id = int(runner.query("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM ingest_run")[0]["n"])
    except (RunnerError, KeyError, IndexError) as e:
        raise UploadError(f"대상 DB 를 읽지 못했습니다(마이그레이션 적용 여부 확인): {e}") from e
    counts_json = json.dumps(manifest["counts"], sort_keys=True)
    verify_json = json.dumps(
        {"ok": rep["ok"], "checks": {c["id"]: c["ok"] for c in rep["checks"]}}, sort_keys=True
    )
    with tempfile.TemporaryDirectory(prefix="yj-ingest-") as tmp:
        ctl = Path(tmp) / "ctl.sql"

        def run_sql(sql: str) -> None:
            ctl.write_bytes((sql + "\n").encode("utf-8"))
            runner.exec_file(ctl)

        run_sql(
            "INSERT INTO ingest_run (id, started_at, finished_at, source_commit, status, counts_json, verify_json) "
            f"VALUES ({run_id}, {sql_literal(started)}, NULL, {sql_literal(manifest['source_commit'])}, 'running', "
            f"{sql_literal(counts_json)}, {sql_literal(verify_json)});"
        )
        log(f"ingest_run #{run_id} running ({runner.label})")
        try:
            for f in manifest["files"]:
                runner.exec_file(out_dir / f["name"])
                log(f"  적용 {f['name']} ({f['statements']}문장)")
            got = remote_counts(runner)
            bad = _compare(manifest, got)
            if bad:
                raise UploadError("적재 후 건수 불일치(I7): " + "; ".join(bad))
            # R1-7: 문서 계층의 검증이 통과한 문서만 verify_ok=1 (전체 일괄 올림 아님)
            slugs = [str(s) for s in manifest.get("verified_slugs", [])]
            if slugs:
                ctl_text = "\n".join(
                    f"UPDATE report_doc SET verify_ok = 1 WHERE slug = {sql_literal(s)};" for s in slugs
                )
                validate_sql(ctl_text, allow_finalize=True)
                run_sql(ctl_text)
            run_sql(
                f"UPDATE ingest_run SET status = 'ok', finished_at = {sql_literal(_iso(now))} WHERE id = {run_id};"
            )
        except Exception as e:
            try:
                run_sql(
                    f"UPDATE ingest_run SET status = 'failed', finished_at = {sql_literal(_iso(now))} WHERE id = {run_id};"
                )
            except Exception:
                log("ingest_run 을 failed 로 표시하지 못했습니다")
            if isinstance(e, UploadError):
                raise
            raise UploadError(f"적재 실패(ingest_run #{run_id} = failed): {e}") from e
    log(f"ingest_run #{run_id} ok")
    return {"run_id": run_id, "counts": manifest["counts"], "tables": manifest["tables"]}


def status(runner: Runner, manifest: dict | None) -> dict:  # type: ignore[type-arg]
    last = runner.query(
        "SELECT id, started_at, finished_at, status, source_commit FROM ingest_run ORDER BY id DESC LIMIT 1"
    )
    got = remote_counts(runner)
    out: dict = {  # type: ignore[type-arg]
        "target": runner.label,
        "last_run": last[0] if last else None,
        "tables": {t: got.get(t) for t in INSERT_ORDER},
    }
    if manifest is not None:
        bad = _compare(manifest, got)
        out["matches_manifest"] = not bad
        out["mismatch"] = bad
    return out
