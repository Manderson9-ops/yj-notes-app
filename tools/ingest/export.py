"""export: DATA_DIR -> SQL 파일들 + manifest.json. 결정적(같은 입력 -> 같은 바이트)."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from . import __version__
from .config import Config
from .layers import VerifierRunner, layer_warnings, run_layer_verifiers, subprocess_runner
from .model import build_all
from .sqlgen import (
    INSERT_ORDER,
    SPEC_BY_NAME,
    TEXT_COLUMNS,
    delete_statements,
    render_parts,
    row_statements,
    validate_sql,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST = "manifest.json"
VERIFY = "verify.json"
MANIFEST_FORMAT = 1

# docs/03 의 counts_json 키 이름
COUNT_KEYS = {
    "note_day": "note_days",
    "note_item": "reports",
    "note_comment": "comments",
    "milestone": "milestones",
    "observation": "observations",
    "growth_ref": "growth_ref",
    "checkup": "checkups",
    "measurement": "measurements",
    "report_doc": "report_docs",
}


class ExportError(ValueError):
    pass


def default_out_root() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        if not base:
            raise ExportError("LOCALAPPDATA 가 없습니다. --out-root 로 저장소 밖 폴더를 지정하세요")
        return Path(base) / "yj-notes" / "ingest"
    state = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(state) / "yj-notes" / "ingest"


def assert_safe_out(out_dir: Path, data_dir: Path | None) -> Path:
    """출력은 저장소 안·DATA_DIR 안에 쓰지 않는다(실제 자료 유출·원본 변경 방지)."""
    out = out_dir.resolve()
    pairs = [(REPO_ROOT, "저장소")]
    if data_dir is not None:
        pairs.append((data_dir.resolve(), "DATA_DIR"))
    for forbidden, why in pairs:
        if out == forbidden or out.is_relative_to(forbidden) or forbidden.is_relative_to(out):
            raise ExportError(f"출력 폴더가 {why} 안(또는 위)입니다. 저장소·DATA_DIR 밖을 쓰세요")
    return out


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class Generated:
    files: dict[str, str]  # 실행 순서대로
    manifest: dict  # type: ignore[type-arg]

    @property
    def digest(self) -> str:
        h = hashlib.sha256()
        for name, text in self.files.items():
            h.update(name.encode())
            h.update(hashlib.sha256(text.encode("utf-8")).digest())
        return h.hexdigest()


def generate(data_dir: Path, cfg: Config, verifier_runner: VerifierRunner = subprocess_runner) -> Generated:
    built = build_all(data_dir, cfg)
    # R1-7: 계층별 검증기 실행(없으면 missing). 실패해도 export 는 계속하고 manifest 에 남긴다.
    layers = run_layer_verifiers(data_dir, verifier_runner)
    for ly in sorted(set(built.doc_layers.values()) - set(layers)):
        layers[ly] = {"status": "missing"}  # 검증기가 정해져 있지 않은 폴더의 문서도 통과로 치지 않는다
    files: dict[str, str] = {}
    meta_files: list[dict] = []  # type: ignore[type-arg]
    files["00_delete.sql"] = "\n".join(delete_statements()) + "\n"
    for n, table in enumerate(INSERT_ORDER, 1):
        spec = SPEC_BY_NAME[table]
        stmts: list[str] = []
        for row in built.tables[table]:
            stmts.extend(row_statements(spec, row))
        for k, part in enumerate(render_parts(stmts), 1):
            files[f"{n * 10:02d}_{table}.{k:03d}.sql"] = part
    for name, text in files.items():
        ops = validate_sql(text)  # 우리가 만든 SQL 도 같은 화이트리스트를 통과해야 한다
        meta_files.append(
            {
                "name": name,
                "sha256": sha256_text(text),
                "bytes": len(text.encode("utf-8")),
                "statements": len(ops),
                "tables": sorted({t for _, t in ops}),
            }
        )
    tables = {t: len(built.tables[t]) for t in INSERT_ORDER}
    # 적재 후 D1 의 SUM(LENGTH(칸)) 과 대조하는 글자 수(긴 칸을 나눠 붙인 결과가 온전한지)
    text_chars = {
        f"{t}.{c}": sum(len(str(r[c])) for r in built.tables[t] if r[c] is not None) for t, c in TEXT_COLUMNS
    }
    days = built.tables["note_day"]
    manifest = {
        "format": MANIFEST_FORMAT,
        "tool_version": __version__,
        "source_commit": built.source_commit,
        "tables": tables,
        "text_chars": text_chars,
        "counts": {COUNT_KEYS[t]: n for t, n in tables.items()},
        "date_range": {
            "min": days[0]["date"] if days else None,
            "max": days[-1]["date"] if days else None,
        },
        "files": meta_files,
        "sources": built.sources,
        "layers": layers,
        "layer_warnings": layer_warnings(layers),
        # 계층 검증을 통과한 계층에 속한 문서만 upload 가 verify_ok=1 로 올린다
        "verified_slugs": sorted(s for s, ly in built.doc_layers.items() if layers[ly]["status"] == "pass"),
    }
    return Generated(files, manifest)


def manifest_text(manifest: dict) -> str:  # type: ignore[type-arg]
    return json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def default_run_id(gen: Generated, now: datetime | None = None) -> str:
    t = (now or datetime.now(UTC)).strftime("%Y%m%d-%H%M%S")
    return f"{t}-{gen.digest[:8]}"


def write_output(gen: Generated, out_dir: Path, force: bool = False) -> None:
    if out_dir.exists() and any(out_dir.iterdir()):
        if not force:
            raise ExportError("출력 폴더가 비어 있지 않습니다. 새 run-id 를 쓰거나 --force")
        for old in out_dir.iterdir():
            if old.is_file() and (old.suffix == ".sql" or old.name in (MANIFEST, VERIFY, "_run_start.sql")):
                old.unlink()
            else:
                raise ExportError("출력 폴더에 알 수 없는 파일이 있어 --force 로도 지우지 않습니다")
    elif out_dir.exists() is False:
        out_dir.mkdir(parents=True)
    for name, text in gen.files.items():
        (out_dir / name).write_bytes(text.encode("utf-8"))
    (out_dir / MANIFEST).write_bytes(manifest_text(gen.manifest).encode("utf-8"))


def latest_run_dir(root: Path) -> Path:
    runs = (
        sorted(p for p in root.iterdir() if p.is_dir() and (p / MANIFEST).is_file()) if root.is_dir() else []
    )
    if not runs:
        raise ExportError(f"적재 가능한 export 결과가 없습니다: {root}")
    return runs[-1]
