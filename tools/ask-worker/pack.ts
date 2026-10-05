// context.py 호출. 질문은 stdin(JSON)으로만 넘긴다(명령줄·로그에 남지 않게).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Expansion } from "./expand.ts";

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
  topics: string[];
  search: SearchSummary;
}

/** 키워드 전수 검색 요약(결정적 검사용): 걸린 글 총 건수·날짜·낱말별 건수, 근거 DB 의 실천(INT-*) ref. */
export interface SearchSummary {
  total: number;
  shown: number;
  dates: string[];
  keywords: Record<string, number>;
  ints: string[];
}

const packSchema = z.object({
  pack: z.string(),
  refs: z.array(z.string()),
  tokens: z.number(),
  runId: z.string(),
  cacheHit: z.boolean(),
  timingMs: z.record(z.string(), z.number()),
  topics: z.array(z.string()),
  search: z.object({
    total: z.number(),
    shown: z.number(),
    dates: z.array(z.string()),
    keywords: z.record(z.string(), z.number()),
    ints: z.array(z.string()),
  }),
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
  expansion?: Expansion,
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
    child.stdin.end(JSON.stringify({ question, ...(expansion ? { expansion } : {}) }));
  });
}
