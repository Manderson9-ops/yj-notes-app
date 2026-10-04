"""R1-7: 계층별 검증기 -> manifest, 문서별 verify_ok, verify 의 WARN. 검증기는 합성 가짜 스크립트."""

from __future__ import annotations

import json
from pathlib import Path

from tools.ingest.cli import main as cli_main
from tools.ingest.export import MANIFEST, generate, write_output
from tools.ingest.layers import LAYER_VERIFIERS, layer_warnings, run_layer_verifiers
from tools.ingest.upload import upload
from tools.ingest.verify import verify, write_report

from .conftest import FAIL_VERIFIER, PASS_VERIFIER, SqliteRunner, add_fake_verifiers


def test_runner_records_pass_fail_missing(verified_data: Path):
    add_fake_verifiers(verified_data, {"wiki": FAIL_VERIFIER})
    got = run_layer_verifiers(verified_data)
    assert got["guide"]["status"] == "pass"
    assert got["wiki"]["status"] == "fail"
    assert got["report"]["status"] == "missing"  # 스크립트 없음
    assert set(got) == set(LAYER_VERIFIERS)
    assert layer_warnings(got) == ["wiki: 검증 실패", "report: 검증기 없음"]


def test_runner_ignores_scripts_that_escape_data_dir(tmp_path: Path):
    # 심볼릭 링크 등으로 DATA_DIR 밖을 가리키면 실행하지 않는다
    data = tmp_path / "d"
    (data / "guide").mkdir(parents=True)
    outside = tmp_path / "outside.py"
    outside.write_text(PASS_VERIFIER, encoding="utf-8")
    link = data / "guide" / "verify_guide.py"
    try:
        link.symlink_to(outside)
    except OSError:
        return  # 권한 없는 환경(Windows 일반 사용자)
    assert run_layer_verifiers(data)["guide"]["status"] == "missing"


def test_export_records_layers_and_does_not_fail_on_verifier_failure(
    verified_data: Path, cfg, tmp_path: Path
):
    add_fake_verifiers(verified_data, {"guide": FAIL_VERIFIER})
    gen = generate(verified_data, cfg)
    m = gen.manifest
    assert m["layers"]["guide"] == {"status": "fail"}
    assert m["layers"]["wiki"] == {"status": "pass"}
    assert m["layers"]["reports"] == {"status": "missing"}  # fixture 의 html 문서 폴더(검증기 미정)
    assert any(w.startswith("guide:") for w in m["layer_warnings"])
    # 통과한 계층의 문서만 verified_slugs
    assert m["verified_slugs"]  # wiki 문서는 통과 계층이라 남는다
    write_output(gen, tmp_path / "o")
    assert json.loads((tmp_path / "o" / MANIFEST).read_text(encoding="utf-8"))["layers"]["guide"]


def test_missing_verifiers_mean_verify_ok_zero_and_warning(fixture_dir: Path, cfg, tmp_path: Path):
    gen = generate(fixture_dir, cfg)  # fixture 에는 검증기가 없다
    assert gen.manifest["verified_slugs"] == []
    assert all(r["status"] == "missing" for r in gen.manifest["layers"].values())
    out = tmp_path / "o"
    write_output(gen, out)
    r = SqliteRunner(tmp_path / "d1.sqlite")
    write_report(out, verify(fixture_dir, out, cfg))
    upload(out, r, log=lambda _: None)
    assert {x["verify_ok"] for x in r.query("SELECT verify_ok FROM report_doc")} == {0}


def test_verify_reports_failed_layers_as_warn_not_fail(verified_data: Path, cfg, tmp_path: Path, capsys):
    add_fake_verifiers(verified_data, {"guide": FAIL_VERIFIER, "wiki": FAIL_VERIFIER})
    root = tmp_path / "root"
    args = ["--data-dir", str(verified_data), "--out-root", str(root)]
    assert cli_main(["export", *args, "--run-id", "r1"]) == 0
    assert "경고(계층 검증): guide: 검증 실패" in capsys.readouterr().out
    assert cli_main(["verify", *args]) == 0  # WARN 은 실패가 아니다
    out = capsys.readouterr().out
    line = next(ln for ln in out.splitlines() if ln.startswith("[WARN] L1"))
    assert "guide" in line and "wiki" in line
    rep = json.loads((root / "r1" / "verify.json").read_text(encoding="utf-8"))
    assert rep["ok"] is True
    assert next(c for c in rep["checks"] if c["id"] == "L1")["warn"] is True


def test_verify_ok_is_per_document_layer(verified_data: Path, cfg, tmp_path: Path):
    add_fake_verifiers(verified_data, {"guide": FAIL_VERIFIER})  # guide 만 실패, wiki 는 통과
    gen = generate(verified_data, cfg)
    out = tmp_path / "o"
    write_output(gen, out)
    write_report(out, verify(verified_data, out, cfg))
    r = SqliteRunner(tmp_path / "d1.sqlite")
    upload(out, r, log=lambda _: None)
    rows = {x["slug"]: x["verify_ok"] for x in r.query("SELECT slug, verify_ok FROM report_doc")}
    assert [s for s, v in rows.items() if v == 1] == gen.manifest["verified_slugs"]
    assert any(v == 0 for v in rows.values()) and any(v == 1 for v in rows.values())
