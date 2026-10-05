"""context.py 테스트 — 합성 픽스처(테스트아이/2020)만 사용."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import context
import fixture_builder
import pytest

HERE = Path(__file__).parent


@pytest.fixture
def env(tmp_path: Path) -> dict[str, Path]:
    paths = fixture_builder.build(tmp_path)
    return {"data": Path(paths["dataDir"]), "ingest": Path(paths["ingestRoot"]), "cache": tmp_path / "cache"}


def pack(env: dict[str, Path], q: str = "테스트아이가 밥을 안 먹어요", **kw):
    return context.build_pack(env["data"], env["ingest"], env["cache"], q, **kw)


def test_pack_has_all_sections_and_refs(env):
    out = pack(env)
    text = out["pack"]
    for head in ("## A. 아이 요약", "## B-1.", "## B-2.", "## B-3."):
        assert head in text
    assert "월령: 30개월" in text
    for ref in ("note:2020-03-02", "SYN-IV-01", "SYN-CL-01", "checkup:1", "SYN-MS-01"):
        assert ref in out["refs"]
        assert f"[ref: {ref}]" in text
    assert any(r.startswith("guide:01-합성#") for r in out["refs"])
    assert "말할 수 없는 것" in text  # not_licensed 포함
    assert out["runId"] == fixture_builder.RUN_ID


def test_refs_match_tags_in_pack(env):
    out = pack(env)
    assert set(context.REF_TAG.findall(out["pack"])) == set(out["refs"])


def test_budget_respected(env):
    out = pack(env, max_tokens=900)
    assert out["tokens"] <= 900 or out["pack"].count("[ref:") <= 3
    big = pack(env)
    assert big["tokens"] <= context.MAX_TOKENS


def test_summary_cache_keyed_by_run(env):
    first = pack(env)
    assert first["cacheHit"] is False
    assert (env["cache"] / f"child-{fixture_builder.RUN_ID}.json").exists()
    assert pack(env)["cacheHit"] is True
    new_run = env["ingest"] / "20200401-000000-synth002"
    new_run.mkdir()
    (new_run / "manifest.json").write_text("{}", "utf-8")
    for f in (env["ingest"] / fixture_builder.RUN_ID).glob("*.sql"):
        (new_run / f.name).write_text(f.read_text("utf-8"), "utf-8")
    again = pack(env)
    assert again["cacheHit"] is False and again["runId"] == "20200401-000000-synth002"
    assert [p.name for p in env["cache"].glob("child-*.json")] == ["child-20200401-000000-synth002.json"]


def test_no_export_raises(tmp_path: Path):
    paths = fixture_builder.build(tmp_path)
    with pytest.raises(LookupError):
        context.build_pack(Path(paths["dataDir"]), tmp_path / "none", tmp_path / "c", "밥")


def test_read_only_no_writes_in_data_dir(env):
    before = sorted(p.relative_to(env["data"]) for p in env["data"].rglob("*"))
    pack(env)
    after = sorted(p.relative_to(env["data"]) for p in env["data"].rglob("*"))
    assert before == after


def test_unrelated_question_still_has_summary(env):
    out = pack(env, "zzzz qqqq")
    assert "## A. 아이 요약" in out["pack"]
    assert "## B-1." not in out["pack"]


def test_synonym_expansion_finds_note(env):
    out = pack(env, "편식이 걱정이에요")
    assert "note:2020-03-04" in out["refs"]


def test_fallback_without_query_behavior(env):
    (env["data"] / "evidence" / "query_behavior.py").unlink()
    assert "note:2020-03-02" in pack(env)["refs"]


def test_est_tokens_monotonic():
    assert context.est_tokens("가나다") > context.est_tokens("abc")
    assert context.est_tokens("") == 0


def test_cli_stdout_json_and_errors(env):
    base = [
        sys.executable,
        str(HERE / "context.py"),
        "--data-dir",
        str(env["data"]),
        "--ingest-root",
        str(env["ingest"]),
        "--cache-dir",
        str(env["cache"]),
    ]
    ok = subprocess.run(
        base,
        input=json.dumps({"question": "밥을 안 먹어요"}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert ok.returncode == 0
    assert json.loads(ok.stdout)["refs"]
    bad = subprocess.run(
        base,
        input=json.dumps({"question": ""}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert bad.returncode == 2 and json.loads(bad.stdout) == {"error": "bad_input"}
