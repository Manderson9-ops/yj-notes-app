"""원본 계층(layer)별 검증기 실행 (R1-7).

DATA_DIR 안에 이미 있는 검증기(tracking/verify_tracking.py 등)를 export 때 한 번씩 돌려 계층별 통과/실패를 manifest 에 남긴다.
문서(report_doc)의 verify_ok 는 그 문서가 속한 계층(경로 첫 폴더)의 결과로만 정한다(전체 하나로 뭉뚱그리지 않는다).
검증기 출력(자료가 섞일 수 있음)은 저장·표시하지 않고 종료 코드만 쓴다. 검증기가 없으면 통과로 치지 않는다(verify_ok=0 + 경고).
export 는 검증기가 실패해도 멈추지 않는다 — `ingest verify` 가 계층 이름과 함께 WARN 으로 알린다.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

LAYER_VERIFIERS: dict[str, str] = {
    "tracking": "tracking/verify_tracking.py",
    "guide": "guide/verify_guide.py",
    "wiki": "wiki/verify_wiki.py",
    "report": "report/verify_report.py",
    "evidence": "evidence/verify_evidence.py",
}
TIMEOUT_SEC = 300

# (스크립트 경로, 실행 폴더) -> 종료 코드. 테스트에서 가짜로 바꿔 끼운다.
VerifierRunner = Callable[[Path, Path], int]


def subprocess_runner(script: Path, cwd: Path) -> int:
    """인제스트와 같은 파이썬으로 실행한다. 출력은 버린다(종료 코드만)."""
    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=TIMEOUT_SEC,
        check=False,
    )
    return proc.returncode


def run_layer_verifiers(
    data_dir: Path, runner: VerifierRunner = subprocess_runner
) -> dict[str, dict[str, str]]:
    """계층 이름 -> {"status": pass|fail|missing|error}. 실행 폴더는 DATA_DIR."""
    root = data_dir.resolve()
    out: dict[str, dict[str, str]] = {}
    for layer, rel in LAYER_VERIFIERS.items():
        script = (root / rel).resolve()
        if not script.is_relative_to(root) or not script.is_file():
            out[layer] = {"status": "missing"}
            continue
        try:
            code = runner(script, root)
        except (OSError, subprocess.SubprocessError):
            out[layer] = {"status": "error"}
            continue
        out[layer] = {"status": "pass" if code == 0 else "fail"}
    return out


def layer_of(rel: str) -> str:
    """DATA_DIR 상대 경로의 첫 폴더 이름."""
    return rel.split("/", 1)[0]


def layer_warnings(layers: dict[str, dict[str, str]]) -> list[str]:
    """통과가 아닌 계층을 이름과 함께 알린다(검증기 출력은 없다)."""
    labels = {"fail": "검증 실패", "missing": "검증기 없음", "error": "검증기 실행 오류"}
    return [f"{name}: {labels[r['status']]}" for name, r in layers.items() if r["status"] != "pass"]
