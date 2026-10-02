"""DATA_DIR 안의 어디에서 무엇을 읽을지. 폴더 구조는 기본값, 바꾸려면 저장소 밖 설정 파일.

실제 자료 경로·파일명(아이 이름이 들어 있을 수 있음)은 코드에 쓰지 않고 패턴만 둔다.
설정 파일 탐색 순서: --config > 환경변수 INGEST_CONFIG > <DATA_DIR>/ingest.config.json > 기본값.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class DocRule:
    dir: str
    glob: str
    kind: str  # 'html' | 'markdown'


@dataclass(frozen=True)
class Config:
    reports_json: str = "_source/kidsnote_*_reports.json"
    notes_dir: str = "alrimjang"
    observations_csv: str = "tracking/observations.csv"
    milestones_csv: str = "evidence/milestones.csv"
    growth_csv: str = "evidence/growth.csv"
    checkup_glob: str = "records/영유아검진/*.xlsx"
    checkup_sheet: str = "검진결과"
    docs: tuple[DocRule, ...] = (
        DocRule("guide", "*.md", "markdown"),
        DocRule("wiki", "*.md", "markdown"),
        DocRule("tracking", "*.md", "markdown"),
        DocRule("report", "*.html", "html"),
        DocRule("report", "*.md", "markdown"),
    )
    # 문서에서 제외할 DATA_DIR 상대 경로(빌드 입력 템플릿 등)
    docs_exclude: tuple[str, ...] = ("report/base.html",)
    # 결과지 항목 이름 -> measurement.measure
    measure_labels: dict[str, str] = field(
        default_factory=lambda: {
            "키": "height_cm",
            "몸무게": "weight_kg",
            "머리둘레": "head_circ_cm",
            "체질량지수(BMI)": "bmi",
        }
    )


_STR_FIELDS = (
    "reports_json",
    "notes_dir",
    "observations_csv",
    "milestones_csv",
    "growth_csv",
    "checkup_glob",
    "checkup_sheet",
)


def check_relative(p: str, what: str) -> None:
    """DATA_DIR 밖으로 나가는 경로(.., 절대경로, 드라이브 문자)를 막는다."""
    if not p or p.startswith(("/", "\\")) or ":" in p or "\\" in p:
        raise ConfigError(f"{what}: DATA_DIR 상대 경로(/ 구분)여야 합니다")
    if ".." in PurePosixPath(p).parts:
        raise ConfigError(f"{what}: '..' 는 쓸 수 없습니다")


def parse_config(raw: dict) -> Config:  # type: ignore[type-arg]
    base = Config()
    kw: dict = {}  # type: ignore[type-arg]
    unknown = set(raw) - set(_STR_FIELDS) - {"docs", "docs_exclude", "measure_labels"}
    if unknown:
        raise ConfigError(f"알 수 없는 설정 키: {sorted(unknown)}")
    for k in _STR_FIELDS:
        if k in raw:
            if not isinstance(raw[k], str):
                raise ConfigError(f"{k}: 문자열이어야 합니다")
            kw[k] = raw[k]
    if "docs" in raw:
        rules = []
        for d in raw["docs"]:
            if not isinstance(d, dict) or set(d) != {"dir", "glob", "kind"}:
                raise ConfigError("docs: {dir, glob, kind} 객체 목록이어야 합니다")
            if d["kind"] not in ("html", "markdown"):
                raise ConfigError("docs.kind 는 html 또는 markdown")
            rules.append(DocRule(d["dir"], d["glob"], d["kind"]))
        kw["docs"] = tuple(rules)
    if "docs_exclude" in raw:
        kw["docs_exclude"] = tuple(raw["docs_exclude"])
    if "measure_labels" in raw:
        kw["measure_labels"] = dict(raw["measure_labels"])
    cfg = Config(**{**base.__dict__, **kw})
    for k in _STR_FIELDS:
        if k != "checkup_sheet":
            check_relative(getattr(cfg, k), k)
    for r in cfg.docs:
        check_relative(r.dir, "docs.dir")
        check_relative(r.glob, "docs.glob")
    for p in cfg.docs_exclude:
        check_relative(p, "docs_exclude")
    return cfg


def load_config(data_dir: Path, explicit: Path | None = None) -> Config:
    path = explicit
    if path is None and os.environ.get("INGEST_CONFIG"):
        path = Path(os.environ["INGEST_CONFIG"])
    if path is None and (data_dir / "ingest.config.json").is_file():
        path = data_dir / "ingest.config.json"
    if path is None:
        return Config()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ConfigError(f"설정 파일을 읽을 수 없습니다: {path.name}") from e
    if not isinstance(raw, dict):
        raise ConfigError("설정 파일 최상위는 객체여야 합니다")
    return parse_config(raw)
