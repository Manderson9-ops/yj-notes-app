// claude CLI 호출기. 구독(로그인) 인증만 쓰도록 API 키 환경변수는 자식 프로세스에서 제거한다.
// 측정된 빠른 플래그 조합: 오버헤드 약 5초. 출력 envelope 은 JSON 한 개(structured_output / result).
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 실패 종류(T-Q4a). stderr·오류 봉투의 result 문구를 정규식으로만 분류하고 문구 자체는 어디에도 남기지 않는다.
 * CLI 문구가 바뀌어 아무 것에도 안 맞으면 other(지금과 같은 동작).
 */
export type ExitKind = "usage_limit" | "auth" | "overloaded" | "other";

// 순서가 우선순위다: auth 가 이긴다(로그인 만료면 다른 무엇도 성공할 수 없다).
const EXIT_PATTERNS: readonly (readonly [Exclude<ExitKind, "other">, RegExp])[] = [
  [
    "auth",
    /\b401\b|authentication_error|unauthori[sz]ed|not logged in|\/login\b|log ?in again|oauth token (?:has )?expired|token has expired|invalid api key/i,
  ],
  [
    "usage_limit",
    /usage limit|hit your limit|limit reached|rate_limit_error|rate limit|\b429\b|too many requests/i,
  ],
  ["overloaded", /overloaded|\b529\b|\b503\b|service unavailable/i],
];

export function classifyExit(text: string): ExitKind {
  for (const [kind, re] of EXIT_PATTERNS) if (re.test(text)) return kind;
  return "other";
}

export class ClaudeError extends Error {
  readonly code: string;
  /** claude_exit·claude_error 일 때만 채운다(그 밖의 실패는 undefined). */
  readonly exitKind: ExitKind | undefined;
  constructor(code: string, exitKind?: ExitKind) {
    super(code);
    this.name = "ClaudeError";
    this.code = code;
    this.exitKind = exitKind;
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

/** 비정상 종료 때 stdout 이 봉투 JSON 이면 그 result 문구(분류용으로만 읽는다). */
export function envelopeResult(stdout: string): string {
  try {
    const e: unknown = JSON.parse(stdout);
    if (e && typeof e === "object") {
      const r = (e as Record<string, unknown>).result;
      if (typeof r === "string") return r;
    }
  } catch {
    // 봉투가 아니면 분류에 쓰지 않는다
  }
  return "";
}

/** stderr: 오류 봉투(is_error)의 분류에만 함께 쓴다. */
export function parseEnvelope(stdout: string, stderr = ""): { output: unknown; model: string } {
  let env: unknown;
  try {
    env = JSON.parse(stdout);
  } catch {
    throw new ClaudeError("envelope_invalid");
  }
  if (!env || typeof env !== "object") throw new ClaudeError("envelope_invalid");
  const e = env as Record<string, unknown>;
  if (e.is_error === true) {
    const result = typeof e.result === "string" ? e.result : "";
    throw new ClaudeError("claude_error", classifyExit(`${stderr}\n${result}`));
  }
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

/** 자식 프로세스 환경: 구독 로그인만 쓰도록 API 키 류를 뺀다. */
export function childEnv(): NodeJS.ProcessEnv {
  // 아래 단언은 tests/ 가 이 파일을 tsconfig.server(workers-types 와 node 타입 혼재)로 컴파일할 때 필요하다.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !STRIP_ENV.includes(k)),
  ) as NodeJS.ProcessEnv;
}

/** 분류용 stderr 는 앞 16KB 만 메모리에 둔다(저장·기록하지 않는다). */
const STDERR_KEEP = 16_000;

export function createClaudeRunner(o: RunnerOptions): ClaudeRunner {
  const work = join(o.home, "work");
  const emptyMcp = join(o.home, "empty-mcp.json");
  return async (req, signal) => {
    mkdirSync(work, { recursive: true });
    writeFileSync(emptyMcp, '{"mcpServers":{}}\n');
    const env = childEnv();
    /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
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
      // 내용은 실패 종류 분류에만 쓰고 버린다(질문·답이 섞일 수 있음)
      const err: Buffer[] = [];
      let errSize = 0;
      child.stderr.on("data", (b: Buffer) => {
        if (errSize < STDERR_KEEP) err.push(b);
        errSize += b.length;
      });
      child.on("error", () => {
        finish(() => {
          reject(new ClaudeError("spawn_failed"));
        });
      });
      child.stdin.on("error", () => undefined);
      child.on("close", (code) => {
        finish(() => {
          const stdout = Buffer.concat(out).toString("utf8");
          const errText = Buffer.concat(err).toString("utf8");
          if (code !== 0) {
            reject(
              new ClaudeError("claude_exit", classifyExit(`${errText}\n${envelopeResult(stdout)}`)),
            );
            return;
          }
          try {
            const { output, model } = parseEnvelope(stdout, errText);
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

/**
 * claude 가 드물게 비정상 종료(claude_exit)하는 일이 실제 평가에서 2회 있었다(재실행하면 통과).
 * 한 번만 2초 뒤 다시 시도한다. 시간 초과·취소·다른 오류는 그대로 올린다.
 * skipAuth(ASK_AUTH_PAUSE=1): 로그인 만료(exitKind=auth)는 다시 해도 실패하므로 재실행하지 않는다.
 */
export function withExitRetry(run: ClaudeRunner, delayMs = 2000, skipAuth = false): ClaudeRunner {
  return async (req, signal) => {
    try {
      return await run(req, signal);
    } catch (e) {
      if (!(e instanceof ClaudeError) || e.message !== "claude_exit" || signal?.aborted) throw e;
      if (skipAuth && e.exitKind === "auth") throw e;
      await new Promise((r) => setTimeout(r, delayMs));
      return run(req, signal);
    }
  };
}

/** 시험 호출 결과(시작·일시정지 해제). */
export type ProbeResult = { ok: true } | { ok: false; kind: ExitKind };
export type Probe = (signal?: AbortSignal) => Promise<ProbeResult>;

/** 시작·해제 시험 호출의 시간 상한(넘기면 other). 일반 호출의 상한을 쓰면 부팅 직후 첫 claim 이 수 분 늦어진다. */
export const PROBE_TIMEOUT_MS = 60_000;
const PROBE_PROMPT = "시험 호출이에요. ok 를 true 로 한 JSON 하나만 내요.";
const PROBE_SCHEMA = JSON.stringify({
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
});

/**
 * 질문 자료 없는 고정 합성 프롬프트로 claude -p 를 한 번 부른다(claim·시도 회계 없음).
 * run 은 시간 상한 PROBE_TIMEOUT_MS 짜리 러너(재실행 없이)여야 한다. 성공 봉투면 로그인이 살아 있다고 본다.
 */
export function createProbe(
  run: ClaudeRunner,
  o: { model: string; systemPromptFile: string },
): Probe {
  return async (signal) => {
    try {
      await run(
        {
          model: o.model,
          effort: "low",
          prompt: PROBE_PROMPT,
          systemPromptFile: o.systemPromptFile,
          schemaJson: PROBE_SCHEMA,
        },
        signal,
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, kind: e instanceof ClaudeError && e.exitKind ? e.exitKind : "other" };
    }
  };
}

/** `claude --version` 첫 줄(평가 결과 머리에 남겨 별칭이 가리키는 모델 변화를 가른다). 실패하면 "unknown". */
export function claudeVersion(bin: string): string {
  const r = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    env: childEnv(),
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  const line = r.status === 0 ? (r.stdout.split(/\r?\n/)[0] ?? "").trim() : "";
  return line === "" ? "unknown" : line.slice(0, 80);
}
