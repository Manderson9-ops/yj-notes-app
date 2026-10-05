// context.py 호출. 질문은 stdin(JSON)으로만 넘긴다(명령줄·로그에 남지 않게).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const CONTEXT_PY = join(dirname(fileURLToPath(import.meta.url)), "context.py");

export class PackError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PackError";
    this.code = code;
  }
}

export interface PackResult {
  pack: string;
  refs: string[];
  tokens: number;
  runId: string;
  cacheHit: boolean;
  timingMs: Record<string, number>;
}

const packSchema = z.object({
  pack: z.string(),
  refs: z.array(z.string()),
  tokens: z.number(),
  runId: z.string(),
  cacheHit: z.boolean(),
  timingMs: z.record(z.string(), z.number()),
});

export interface PackOptions {
  pythonBin: string;
  dataDir: string;
  ingestRoot?: string;
  cacheDir: string;
  /** 아이 생년월일(YYYY-MM-DD, 선택). 있으면 월령을 이것으로 계산한다. */
  birthDate?: string;
  timeoutMs?: number;
}

export function buildPack(
  o: PackOptions,
  question: string,
  signal?: AbortSignal,
): Promise<PackResult> {
  const args = [CONTEXT_PY, "--data-dir", o.dataDir, "--cache-dir", o.cacheDir];
  if (o.ingestRoot) args.push("--ingest-root", o.ingestRoot);
  return new Promise((resolveRun, reject) => {
    const child = spawn(o.pythonBin, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        ...(o.birthDate ? { YJ_CHILD_BIRTH_DATE: o.birthDate } : {}),
      },
      ...(signal ? { signal } : {}),
    });
    const out: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
    }, o.timeoutMs ?? 60_000);
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.on("error", () => {
      clearTimeout(timer);
      reject(new PackError("pack_spawn_failed"));
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const json: unknown = JSON.parse(Buffer.concat(out).toString("utf8"));
        const parsed = packSchema.safeParse(json);
        if (!parsed.success) throw new Error("shape");
        resolveRun(parsed.data);
      } catch {
        reject(new PackError("pack_failed"));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ question }));
  });
}
