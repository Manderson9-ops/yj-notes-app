// npm 스크립트용 Python 실행기: 쓸 수 있는 Python 3.11+ 를 찾아 `python -m tools.ingest <인자>` 를 돌린다.
//   node tools/ingest/run.ts export|verify|upload|status ...   -> python -m tools.ingest ...
//   node tools/ingest/run.ts --py pytest                       -> python -m pytest ...
// 찾는 순서: 환경변수 INGEST_PYTHON > .venv > py -3 > python3 > python. 실제 로직은 전부 Python(ADR-0005).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

interface Candidate {
  cmd: string;
  prefix: string[];
}

function candidates(): Candidate[] {
  const out: Candidate[] = [];
  const env = process.env.INGEST_PYTHON;
  if (env) out.push({ cmd: env, prefix: [] });
  for (const p of [
    join(root, ".venv", "Scripts", "python.exe"),
    join(root, ".venv", "bin", "python"),
  ]) {
    if (existsSync(p)) out.push({ cmd: p, prefix: [] });
  }
  if (process.platform === "win32") out.push({ cmd: "py", prefix: ["-3"] });
  out.push({ cmd: "python3", prefix: [] }, { cmd: "python", prefix: [] });
  return out;
}

// Aside·다른 도구가 심어 둔 파이썬 환경변수가 있으면 표준 라이브러리 로딩이 깨질 수 있다.
function cleanEnv(): NodeJS.ProcessEnv {
  const drop = new Set(["PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop.has(k)));
  return { ...env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
}

function usable(c: Candidate, env: NodeJS.ProcessEnv): boolean {
  const r = spawnSync(
    c.cmd,
    [...c.prefix, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"],
    { env, stdio: "ignore" },
  );
  return r.status === 0;
}

const args = process.argv.slice(2);
const env = cleanEnv();
const py = candidates().find((c) => usable(c, env));
if (!py) {
  console.error("Python 3.11+ 를 찾지 못했습니다. 설치하거나 INGEST_PYTHON 에 경로를 지정하세요.");
  process.exit(2);
}
const rest = args[0] === "--py" ? args.slice(1) : ["tools.ingest", ...args];
const [first, ...tail] = rest;
const pyArgs = ["-m", first ?? "tools.ingest", ...tail];
const res = spawnSync(py.cmd, [...py.prefix, ...pyArgs], { cwd: root, env, stdio: "inherit" });
process.exit(res.status ?? 1);
