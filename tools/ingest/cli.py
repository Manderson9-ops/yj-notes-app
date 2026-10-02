"""명령줄: python -m tools.ingest {export|verify|upload|status}. 출력에는 건수·구조만 쓴다."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .config import ConfigError, load_config
from .export import (
    MANIFEST,
    REPO_ROOT,
    ExportError,
    assert_safe_out,
    default_out_root,
    default_run_id,
    generate,
    latest_run_dir,
    write_output,
)
from .model import SourceError
from .sqlgen import SqlError
from .upload import UploadError, load_checked, status, upload
from .verify import verify, write_report
from .wrangler import Runner, RunnerError, WranglerRunner


def _data_dir(arg: str | None) -> Path:
    v = arg or os.environ.get("DATA_DIR")
    if not v:
        raise ExportError("--data-dir 또는 환경변수 DATA_DIR 가 필요합니다")
    return Path(v)


def _out_dir(args: argparse.Namespace, data_dir: Path | None) -> Path:
    # 저장소 안 경로는 거부한다(upload/status 도 같은 규칙)
    if args.out:
        out = Path(args.out)
    else:
        out = latest_run_dir(Path(args.out_root) if args.out_root else default_out_root())
    return assert_safe_out(out, data_dir)


def cmd_export(args: argparse.Namespace) -> int:
    data_dir = _data_dir(args.data_dir)
    cfg = load_config(data_dir, Path(args.config) if args.config else None)
    gen = generate(data_dir, cfg)
    if args.out:
        out = Path(args.out)
    else:
        root = Path(args.out_root) if args.out_root else default_out_root()
        out = root / (args.run_id or default_run_id(gen))
    out = assert_safe_out(out, data_dir)
    write_output(gen, out, force=args.force)
    print(f"export 완료: {out}")
    print(f"  SQL 파일 {len(gen.files)}개, 원본 해시 {len(gen.manifest['sources'])}개")
    for k, n in gen.manifest["counts"].items():
        print(f"  {k}: {n}")
    print(f"  날짜 범위: {gen.manifest['date_range']['min']} ~ {gen.manifest['date_range']['max']}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    data_dir = _data_dir(args.data_dir)
    cfg = load_config(data_dir, Path(args.config) if args.config else None)
    out = _out_dir(args, data_dir)
    checks = verify(data_dir, out, cfg)
    write_report(out, checks)
    for c in checks:
        print(f"[{'OK' if c.ok else 'FAIL'}] {c.id} {c.title} - {c.detail}")
    ok = all(c.ok for c in checks)
    print("verify " + ("통과" if ok else "실패") + f": {out}")
    return 0 if ok else 1


def _runner(args: argparse.Namespace) -> Runner:
    target = "remote" if args.remote else "local"
    if target == "remote" and not args.yes:
        raise UploadError("--remote 는 --yes 를 함께 줘야 합니다(운영 DB 변경)")
    return WranglerRunner(target, REPO_ROOT, args.database)


def cmd_upload(args: argparse.Namespace) -> int:
    out = _out_dir(args, None)
    runner = _runner(args)
    res = upload(out, runner)
    print(f"upload 완료 ({runner.label}), ingest_run #{res['run_id']}")
    for k, n in res["counts"].items():
        print(f"  {k}: {n}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    runner = _runner(args)
    manifest = None
    try:
        out = _out_dir(args, None)
        manifest = load_checked(out) if (out / MANIFEST).is_file() else None
    except (ExportError, UploadError):
        manifest = None
    res = status(runner, manifest)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get("matches_manifest", True) else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m tools.ingest", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp: argparse.ArgumentParser, data: bool) -> None:
        if data:
            sp.add_argument("--data-dir", help="비공개 자료 폴더(기본: 환경변수 DATA_DIR). 읽기만 한다")
            sp.add_argument(
                "--config", help="폴더 구조 설정 JSON(기본: INGEST_CONFIG 또는 DATA_DIR/ingest.config.json)"
            )
        sp.add_argument("--out", help="export 결과 폴더(기본: 가장 최근 run)")
        sp.add_argument("--out-root", help="run 폴더들의 부모(기본: %%LOCALAPPDATA%%/yj-notes/ingest)")

    e = sub.add_parser("export", help="DATA_DIR -> SQL + manifest.json")
    common(e, True)
    e.add_argument("--run-id", help="run 폴더 이름(기본: 시각-내용해시)")
    e.add_argument("--force", action="store_true", help="기존 출력 파일을 덮어쓴다")
    e.set_defaults(fn=cmd_export)

    v = sub.add_parser("verify", help="export 결과를 원본과 대조(I1~I8)")
    common(v, True)
    v.set_defaults(fn=cmd_verify)

    for name, fn, help_ in (
        ("upload", cmd_upload, "검증된 export 결과를 D1 에 적용"),
        ("status", cmd_status, "D1 건수 vs manifest 건수"),
    ):
        s = sub.add_parser(name, help=help_)
        common(s, False)
        g = s.add_mutually_exclusive_group(required=True)
        g.add_argument("--local", action="store_true", help="로컬 D1(.wrangler/state)")
        g.add_argument("--remote", action="store_true", help="운영 D1 (관리자만, --yes 필요)")
        s.add_argument("--yes", action="store_true", help="--remote 확인")
        s.add_argument("--database", default="DB", help="wrangler.toml 의 D1 binding 이름")
        s.set_defaults(fn=fn)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.fn(args))
    except (ConfigError, SourceError, ExportError, SqlError, UploadError, RunnerError) as e:
        print(f"오류: {e}", file=sys.stderr)
        return 2
