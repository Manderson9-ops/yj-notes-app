// claude CLI 호출기. 구독(로그인) 인증만 쓰도록 API 키 환경변수는 자식 프로세스에서 제거한다.
// 측정된 빠른 플래그 조합: 오버헤드 약 5초. 출력 envelope 은 JSON 한 개(structured_output / result).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class ClaudeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ClaudeError";
    this.code = code;
  }
}

export interface ClaudeRequest {
  /** 기본 opus. 질문 확장 같은 가벼운 호출은 haiku. */
  model?: string;
  /** 생각 깊이(--effort). 질문 확장처럼 가벼운 호출은 low. */
  effort?: "low" | "medium" | "high";
  prompt: string;
  systemPromptFile: string;
  schemaJson: string;
}

export interface ClaudeResult {
  output: unknown;
  ms: number;
  model: string;
}

export type ClaudeRunner = (req: ClaudeRequest, signal?: AbortSignal) => Promise<ClaudeResult>;

export interface RunnerOptions {
  bin: string;
  home: string; // ~/.yj-ask
  timeoutMs: number;
  argsPrefix?: string[]; // 시험용(node 로 가짜 claude 스크립트를 돌릴 때)
}

const STRIP_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ASK_WORKER_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
];

export function claudeArgs(emptyMcp: string, req: ClaudeRequest): string[] {
  return [
    "-p",
    "--model",
    req.model ?? "opus",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    emptyMcp,
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    req.schemaJson,
    "--system-prompt-file",
    req.systemPromptFile,
    ...(req.effort ? ["--effort", req.effort] : []),
  ];
}

export function parseEnvelope(stdout: string): { output: unknown; model: string } {
  let env: unknown;
  try {
    env = JSON.parse(stdout);
  } catch {
    throw new ClaudeError("envelope_invalid");
  }
  if (!env || typeof env !== "object") throw new ClaudeError("envelope_invalid");
  const e = env as Record<string, unknown>;
  if (e.is_error === true) throw new ClaudeError("claude_error");
  let output: unknown = e.structured_output;
  if (output === undefined || output === null) {
    if (typeof e.result !== "string") throw new ClaudeError("envelope_invalid");
    try {
      output = JSON.parse(e.result);
    } catch {
      throw new ClaudeError("output_not_json");
    }
  }
  const usage = e.modelUsage;
  const model = usage && typeof usage === "object" ? (Object.keys(usage)[0] ?? "opus") : "opus";
  return { output, model };
}

export function createClaudeRunner(o: RunnerOptions): ClaudeRunner {
  const work = join(o.home, "work");
  const emptyMcp = join(o.home, "empty-mcp.json");
  return async (req, signal) => {
    mkdirSync(work, { recursive: true });
    writeFileSync(emptyMcp, '{"mcpServers":{}}\n');
    // 아래 단언은 tests/ 가 이 파일을 tsconfig.server(workers-types 와 node 타입 혼재)로 컴파일할 때 필요하다.
    /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !STRIP_ENV.includes(k)),
    ) as NodeJS.ProcessEnv;
    const started = performance.now();
    return await new Promise<ClaudeResult>((resolveRun, reject) => {
      const child = spawn(o.bin, [...(o.argsPrefix ?? []), ...claudeArgs(emptyMcp, req)], {
        cwd: work,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as unknown as ChildProcessWithoutNullStreams;
      /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */
      const out: Buffer[] = [];
      let size = 0;
      let done = false;
      const onAbort = () => {
        child.kill();
        finish(() => {
          reject(new ClaudeError("aborted"));
        });
      };
      function finish(fn: () => void) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn();
      }
      const timer = setTimeout(() => {
        child.kill();
        finish(() => {
          reject(new ClaudeError("timeout"));
        });
      }, o.timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      child.stdout.on("data", (b: Buffer) => {
        size += b.length;
        if (size > 4_000_000) {
          child.kill();
          finish(() => {
            reject(new ClaudeError("output_too_large"));
          });
        } else out.push(b);
      });
      child.stderr.resume(); // 내용은 버린다(질문·답이 섞일 수 있음)
      child.on("error", () => {
        finish(() => {
          reject(new ClaudeError("spawn_failed"));
        });
      });
      child.stdin.on("error", () => undefined);
      child.on("close", (code) => {
        finish(() => {
          if (code !== 0) {
            reject(new ClaudeError("claude_exit"));
            return;
          }
          try {
            const { output, model } = parseEnvelope(Buffer.concat(out).toString("utf8"));
            resolveRun({ output, model, ms: Math.round(performance.now() - started) });
          } catch (err) {
            reject(err instanceof Error ? err : new ClaudeError("envelope_invalid"));
          }
        });
      });
      child.stdin.end(req.prompt);
    });
  };
}
