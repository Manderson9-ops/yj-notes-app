from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from tools.ingest import cli
from tools.ingest.export import MANIFEST, REPO_ROOT, latest_run_dir
from tools.ingest.tests.gen_fixture import build_files

from .conftest import FIXTURE


def run(argv: list[str]) -> int:
    return cli.main(argv)


def test_export_verify_roundtrip_cli(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    root = tmp_path / "root"
    assert run(["export", "--data-dir", str(FIXTURE), "--out-root", str(root), "--run-id", "r1"]) == 0
    out = capsys.readouterr().out
    assert "reports: 32" in out and "comments: 40" in out
    assert "블록" not in out and "교사A" not in out  # 자료 내용은 출력하지 않는다
    assert run(["verify", "--data-dir", str(FIXTURE), "--out-root", str(root)]) == 0  # 가장 최근 run
    out = capsys.readouterr().out
    assert "[FAIL]" not in out and "verify 통과" in out
    assert latest_run_dir(root) == root / "r1"
    assert (root / "r1" / "verify.json").is_file()
    # 같은 run-id 로 다시: --force 없이는 거부, 있으면 같은 바이트
    before = (root / "r1" / MANIFEST).read_bytes()
    assert run(["export", "--data-dir", str(FIXTURE), "--out-root", str(root), "--run-id", "r1"]) == 2
    assert (
        run(["export", "--data-dir", str(FIXTURE), "--out-root", str(root), "--run-id", "r1", "--force"]) == 0
    )
    assert (root / "r1" / MANIFEST).read_bytes() == before
    assert not (root / "r1" / "verify.json").exists()  # export 가 이전 verify 결과를 지운다


def test_default_run_id_has_timestamp_and_digest(tmp_path: Path):
    assert run(["export", "--data-dir", str(FIXTURE), "--out-root", str(tmp_path)]) == 0
    (d,) = list(tmp_path.iterdir())
    assert re.fullmatch(r"\d{8}-\d{6}-[0-9a-f]{8}", d.name)


def test_export_refuses_repo_inside_and_missing_data_dir(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
):
    assert run(["export", "--data-dir", str(FIXTURE), "--out", str(REPO_ROOT / ".ingest-test-out")]) == 2
    assert not (REPO_ROOT / ".ingest-test-out").exists()
    assert "저장소" in capsys.readouterr().err
    monkeypatch.delenv("DATA_DIR", raising=False)
    assert run(["export", "--out-root", str(tmp_path)]) == 2
    assert run(["export", "--data-dir", str(tmp_path / "nope"), "--out-root", str(tmp_path)]) == 2


def test_verify_exit_code_on_failure(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    root = tmp_path / "root"
    run(["export", "--data-dir", str(FIXTURE), "--out-root", str(root), "--run-id", "r1"])
    f = next((root / "r1").glob("*note_day*.sql"))
    f.write_bytes(f.read_bytes() + b"\n")
    capsys.readouterr()
    assert run(["verify", "--data-dir", str(FIXTURE), "--out", str(root / "r1")]) == 1
    assert "[FAIL] F1" in capsys.readouterr().out


def test_remote_requires_yes_and_exactly_one_target(tmp_path: Path):
    with pytest.raises(SystemExit):
        run(["upload", "--out", str(tmp_path)])  # --local/--remote 중 하나 필수
    with pytest.raises(SystemExit):
        run(["upload", "--local", "--remote"])
    assert run(["upload", "--remote", "--out", str(tmp_path)]) == 2  # --yes 없이는 wrangler 도 부르지 않는다
    assert run(["status", "--remote", "--out", str(tmp_path)]) == 2


def test_upload_refuses_out_inside_repo():
    assert run(["upload", "--local", "--out", str(REPO_ROOT / "tools")]) == 2


def test_committed_fixture_matches_generator(tmp_path: Path):
    """fixtures/data_dir 는 gen_fixture 의 결과와 바이트 단위로 같다(손으로 고치지 않는다)."""
    want = build_files()
    have = sorted(p.relative_to(FIXTURE).as_posix() for p in FIXTURE.rglob("*") if p.is_file())
    assert have == sorted(want)
    for rel, text in want.items():
        assert (FIXTURE / rel).read_bytes() == text.encode("utf-8"), rel


def test_fixture_is_synthetic_and_text_only():
    cfg = json.loads((FIXTURE / "ingest.config.json").read_text(encoding="utf-8"))
    assert cfg["notes_dir"] == "notes"  # 실제 폴더 이름(가드 G1 금지 이름)을 쓰지 않는다
    for p in FIXTURE.rglob("*"):
        if p.is_file():
            text = p.read_bytes().decode("utf-8")  # 바이너리 없음
            assert "kidsnote.com" not in text
    data = json.loads((FIXTURE / "source" / "synthetic_reports.json").read_text(encoding="utf-8"))
    assert data["meta"]["birth"] == "2020-01-15" and data["meta"]["child"] == "테스트아이"
