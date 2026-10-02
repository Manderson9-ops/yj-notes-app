"""wrangler d1 execute 를 감싼 Runner. 오류 출력에서 SQL·자료 조각이 새지 않게 걸러낸다."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Protocol


class RunnerError(RuntimeError):
    pass


class Runner(Protocol):
    label: str

    def exec_file(self, path: Path) -> None: ...

    def query(self, sql: str) -> list[dict]: ...  # type: ignore[type-arg]


def sanitize_error(text: str) -> str:
    """오류 요약만 남긴다: 코드 이름(D1_ERROR/SQLITE_*)과 따옴표 밖 짧은 문구."""
    keep: list[str] = []
    for line in text.splitlines():
        if re.search(r"D1_ERROR|SQLITE_|ERROR|Error|error", line):
            m = re.search(r'"text":\s*"(.*)"', line)  # wrangler --json 오류 형태
            cleaned = re.sub(r"'[^']*'|\"[^\"]*\"", "'…'", m.group(1) if m else line).strip()
            keep.append(cleaned[:160])
        if len(keep) >= 3:
            break
    return " / ".join(keep) or "상세 없음"


class WranglerRunner:
    def __init__(self, target: str, repo_root: Path, database: str = "DB") -> None:
        if target not in ("local", "remote"):
            raise RunnerError("target 은 local 또는 remote")
        self.target = target
        self.label = f"{target}:{database}"
        self.repo_root = repo_root
        self.database = database
        node = shutil.which("node")
        script = repo_root / "node_modules" / "wrangler" / "bin" / "wrangler.js"
        if not node or not script.is_file():
            raise RunnerError("node 또는 node_modules/wrangler 가 없습니다(npm ci 먼저)")
        self._base = [node, str(script), "d1", "execute", database, f"--{target}"]

    def _run(self, extra: list[str]) -> str:
        try:
            r = subprocess.run(
                [*self._base, *extra],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=600,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as e:
            raise RunnerError(f"wrangler 실행 실패: {type(e).__name__}") from e
        if r.returncode != 0:
            raise RunnerError(
                f"wrangler 종료 코드 {r.returncode}: {sanitize_error(r.stdout + chr(10) + r.stderr)}"
            )
        return r.stdout

    def exec_file(self, path: Path) -> None:
        self._run(["--file", str(path), "--json"])

    def query(self, sql: str) -> list[dict]:  # type: ignore[type-arg]
        out = self._run(["--command", sql, "--json"])
        try:
            data = json.loads(out)
            return list(data[0]["results"])
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise RunnerError("wrangler 출력(JSON)을 해석하지 못했습니다") from e
