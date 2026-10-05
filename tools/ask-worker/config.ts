// 워커 설정. %USERPROFILE%\.yj-ask\worker.env (APP_ORIGIN, ASK_WORKER_TOKEN).
// 저장소 안 · Google Drive 안에 있는 설정 파일은 거부한다(비밀값이 동기화·커밋되는 사고 방지).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function askHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.USERPROFILE ?? homedir(), ".yj-ask");
}

const DRIVE_RE =
  /(?:^|[\\/])(?:google ?drive|googledrive|내 드라이브|구글 ?드라이브|my drive)(?:[\\/]|$)/i;

function real(p: string): string {
  const abs = resolve(p);
  try {
    return existsSync(abs) ? realpathSync.native(abs) : abs;
  } catch {
    return abs;
  }
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(real(parent), real(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertOutsideRepo(p: string, repoRoot: string = REPO_ROOT): void {
  if (isInside(p, repoRoot))
    throw new Error("저장소 안의 경로는 쓸 수 없어요 (비밀·실제 자료 보호)");
}

export function assertSafeConfigPath(p: string, repoRoot: string = REPO_ROOT): void {
  assertOutsideRepo(p, repoRoot);
  if (DRIVE_RE.test(real(p)) || DRIVE_RE.test(resolve(p))) {
    throw new Error("Google Drive 안의 설정 파일은 쓸 수 없어요 (동기화로 토큰이 퍼져요)");
  }
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    let v = t.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

export interface WorkerConfig {
  origin: string;
  token: string;
  pythonBin: string;
  claudeBin: string;
  dataDir: string;
  pollMs: number;
  targetScore: number;
  minPublishScore: number;
  claudeTimeoutMs: number;
  home: string;
}

export interface LoadOptions {
  file?: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  requireToken?: boolean;
  readFile?: (p: string) => string;
}

function num(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

export function normalizeOrigin(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("APP_ORIGIN 형식이 올바르지 않아요");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    throw new Error("APP_ORIGIN 은 https 여야 해요 (로컬 시험은 http://localhost 만)");
  }
  return u.origin;
}

export function loadConfig(opts: LoadOptions = {}): WorkerConfig {
  const env = opts.env ?? process.env;
  const home = askHome(env);
  const file = opts.file ?? join(home, "worker.env");
  assertSafeConfigPath(file, opts.repoRoot ?? REPO_ROOT);
  let text = "";
  try {
    text = (opts.readFile ?? ((p) => readFileSync(p, "utf8")))(file);
  } catch {
    if (opts.requireToken !== false) throw new Error(`설정 파일을 읽을 수 없어요: ${file}`);
  }
  const f = parseEnvFile(text);
  const origin = f.APP_ORIGIN ? normalizeOrigin(f.APP_ORIGIN) : "";
  const token = f.ASK_WORKER_TOKEN ?? "";
  if (opts.requireToken !== false) {
    if (!origin) throw new Error("worker.env 에 APP_ORIGIN 이 없어요");
    if (token.length < 16) throw new Error("worker.env 의 ASK_WORKER_TOKEN 이 없거나 너무 짧아요");
  }
  return {
    origin,
    token,
    pythonBin: f.PYTHON_BIN ?? env.PYTHON_BIN ?? "python",
    claudeBin: f.CLAUDE_BIN ?? env.CLAUDE_BIN ?? "claude",
    dataDir: f.DATA_DIR ?? env.DATA_DIR ?? "",
    pollMs: num(f.ASK_POLL_MS, 10_000, 2_000, 120_000),
    targetScore: 9.5,
    minPublishScore: num(f.ASK_MIN_PUBLISH_SCORE, 8.5, 0, 10),
    claudeTimeoutMs: num(f.ASK_CLAUDE_TIMEOUT_MS, 240_000, 30_000, 900_000),
    home,
  };
}
