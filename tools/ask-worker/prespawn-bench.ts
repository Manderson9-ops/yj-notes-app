// claude 미리 띄우기 벤치(S4 — T-Q4a 에서 1회 실행, 운영 코드 prespawn() 은 통과 시 T-Q4b).
//   node tools/ask-worker/prespawn-bench.ts --out <저장소·DATA_DIR 밖 폴더> [--bin claude] [--model opus]
//                                           [--pairs 5] [--overlap 10] [--delay-ms 6000] [--timeout-ms 120000]
// 운영과 같은 플래그(claudeArgs)·고정 합성 프롬프트(질문 자료 없음)로 「즉시 쓰기」와 「6초 뒤 쓰기」의 stdin 쓰기 → 종료 시간을 잰다.
// 한 쌍 = 두 방식을 연달아 1회씩, 쌍마다 순서를 번갈아 바꾼다. 따로 두 프로세스를 겹쳐 띄우는 실행(한쪽 즉시, 한쪽 6초 뒤 쓰기)으로
// 비정상 종료 수를 센다. 채택 = 쌍별 차(즉시 − 6초 뒤) 중앙값 ≥ 3s 이고 4/5 쌍 이상에서 6초 뒤 쪽이 빠르며
// 겹쳐 띄우기 비정상 종료 0(시간 초과·실행 실패도 0).
// 결과 파일에는 시간·종료 코드만 남는다(프롬프트·응답 본문 없음).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnv, claudeArgs, claudeVersion } from "./claude.ts";
import { assertOutsideRepo } from "./config.ts";
import { PROBE_PROMPT_FILE } from "./prompts.ts";

const PROMPT = "벤치 호출이에요. ok 를 true 로 한 JSON 하나만 내요.";
const SCHEMA = JSON.stringify({
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
});

export type WriteMode = "immediate" | "delayed";

export interface TimedRun {
  mode: WriteMode;
  /** stdin 쓰기 → 종료(ms). 미리 띄우기가 숨길 수 있는 것은 이 값의 차이다. 쓰기 전에 끝났으면 null. */
  writeToExitMs: number | null;
  spawnToExitMs: number;
  /** 종료 코드(시간 초과·실행 실패면 null). */
  code: number | null;
  /** timeout · spawn_failed · exited_before_write(CLI 가 stdin 을 기다리지 않고 먼저 끝남) */
  error?: string;
}

export interface BenchOptions {
  bin: string;
  argsPrefix?: string[]; // 시험용(가짜 claude 스크립트)
  home: string;
  model: string;
  delayMs: number;
  timeoutMs: number;
}

export function runOnce(o: BenchOptions, mode: WriteMode): Promise<TimedRun> {
  const emptyMcp = join(o.home, "empty-mcp.json");
  const work = join(o.home, "work");
  mkdirSync(work, { recursive: true });
  writeFileSync(emptyMcp, '{"mcpServers":{}}\n');
  const args = claudeArgs(emptyMcp, {
    model: o.model,
    prompt: PROMPT,
    systemPromptFile: PROBE_PROMPT_FILE,
    schemaJson: SCHEMA,
  });
  return new Promise((resolve) => {
    const t0 = performance.now();
    let tWrite: number | null = null;
    let done = false;
    const child = spawn(o.bin, [...(o.argsPrefix ?? []), ...args], {
      cwd: work,
      env: childEnv(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const end = (code: number | null, error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(writeTimer);
      const t = performance.now();
      const why = error ?? (tWrite === null ? "exited_before_write" : undefined);
      resolve({
        mode,
        writeToExitMs: tWrite === null ? null : Math.round(t - tWrite),
        spawnToExitMs: Math.round(t - t0),
        code,
        ...(why ? { error: why } : {}),
      });
    };
    const timer = setTimeout(() => {
      child.kill();
      end(null, "timeout");
    }, o.timeoutMs);
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    child.on("error", () => {
      end(null, "spawn_failed");
    });
    child.on("close", (code) => {
      end(code);
    });
    const write = () => {
      tWrite = performance.now();
      child.stdin.end(PROMPT);
    };
    const writeTimer = setTimeout(write, mode === "immediate" ? 0 : o.delayMs);
  });
}

export interface Pair {
  order: [WriteMode, WriteMode];
  immediate: TimedRun;
  delayed: TimedRun;
}

export interface OverlapRun {
  a: TimedRun;
  b: TimedRun;
}

const ok = (r: TimedRun): boolean => r.code === 0 && !r.error;

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? NaN : s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

export interface Decision {
  /** 쌍별 차(즉시 − 6초 뒤, ms). 양수 = 6초 뒤 쪽이 빠름(미리 정한 방향). */
  diffsMs: number[];
  medianDiffMs: number;
  /** 정한 방향인 쌍 수 / 필요 수. */
  direction: number;
  directionNeeded: number;
  /** 두 실행 중 하나라도 실패한 쌍 수(있으면 채택하지 않는다). */
  failedPairs: number;
  /** 겹쳐 띄우기의 비정상 종료(종료 코드 ≠ 0) 수. */
  overlapAbnormal: number;
  /** 겹쳐 띄우기의 시간 초과·실행 실패 수(이것도 있으면 채택하지 않는다). */
  overlapOther: number;
  adopt: boolean;
}

export function decide(pairs: readonly Pair[], overlap: readonly OverlapRun[]): Decision {
  const valid = pairs.filter((p) => ok(p.immediate) && ok(p.delayed));
  const diffsMs = valid.map(
    (p) => (p.immediate.writeToExitMs ?? 0) - (p.delayed.writeToExitMs ?? 0),
  );
  const medianDiffMs = median(diffsMs);
  const direction = diffsMs.filter((d) => d > 0).length;
  const directionNeeded = Math.ceil(pairs.length * 0.8);
  const runs = overlap.flatMap((o) => [o.a, o.b]);
  const overlapAbnormal = runs.filter((r) => r.code !== null && r.code !== 0).length;
  const overlapOther = runs.filter((r) => r.code === null).length;
  const failedPairs = pairs.length - valid.length;
  return {
    diffsMs,
    medianDiffMs,
    direction,
    directionNeeded,
    failedPairs,
    overlapAbnormal,
    overlapOther,
    adopt:
      failedPairs === 0 &&
      pairs.length > 0 &&
      medianDiffMs >= 3000 &&
      direction >= directionNeeded &&
      overlapAbnormal === 0 &&
      overlapOther === 0,
  };
}

export async function runBench(
  o: BenchOptions,
  n: { pairs: number; overlap: number },
  onProgress: (line: string) => void = () => undefined,
): Promise<{ pairs: Pair[]; overlap: OverlapRun[]; decision: Decision }> {
  const pairs: Pair[] = [];
  for (let i = 0; i < n.pairs; i++) {
    const order: [WriteMode, WriteMode] =
      i % 2 === 0 ? ["immediate", "delayed"] : ["delayed", "immediate"];
    const first = await runOnce(o, order[0]);
    const second = await runOnce(o, order[1]);
    const byMode = (m: WriteMode) => (first.mode === m ? first : second);
    pairs.push({ order, immediate: byMode("immediate"), delayed: byMode("delayed") });
    onProgress(
      `pair ${String(i + 1)}: immediate ${String(byMode("immediate").writeToExitMs)}ms / delayed ${String(byMode("delayed").writeToExitMs)}ms${byMode("delayed").error ? ` (${byMode("delayed").error ?? ""})` : ""}`,
    );
  }
  const overlap: OverlapRun[] = [];
  for (let i = 0; i < n.overlap; i++) {
    const [a, b] = await Promise.all([runOnce(o, "immediate"), runOnce(o, "delayed")]);
    overlap.push({ a, b });
    onProgress(`overlap ${String(i + 1)}: codes ${String(a.code)} / ${String(b.code)}`);
  }
  return { pairs, overlap, decision: decide(pairs, overlap) };
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(args: string[]): Promise<number> {
  const out = opt(args, "--out");
  if (!out) {
    console.error(
      "사용: prespawn-bench.ts --out <저장소·DATA_DIR 밖 폴더> [--bin claude] [--model opus] [--pairs 5] [--overlap 10] [--delay-ms 6000]",
    );
    return 1;
  }
  assertOutsideRepo(out);
  const bin = opt(args, "--bin") ?? process.env.CLAUDE_BIN ?? "claude";
  const o: BenchOptions = {
    bin,
    home: join(out, "bench-home"), // 빈 작업 폴더·빈 MCP 설정만(워커 홈은 건드리지 않는다)
    model: opt(args, "--model") ?? "opus",
    delayMs: Number(opt(args, "--delay-ms") ?? 6000),
    timeoutMs: Number(opt(args, "--timeout-ms") ?? 120_000),
  };
  const n = {
    pairs: Number(opt(args, "--pairs") ?? 5),
    overlap: Number(opt(args, "--overlap") ?? 10),
  };
  const version = claudeVersion(bin);
  const startedAt = new Date().toISOString();
  const r = await runBench(o, n, (l) => {
    console.log(l);
  });
  mkdirSync(out, { recursive: true });
  const file = join(out, `prespawn-bench-${startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { startedAt, claudeVersion: version, model: o.model, delayMs: o.delayMs, ...n, ...r },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(r.decision));
  console.log(`결과 저장: ${file}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : "벤치 오류");
      process.exit(1);
    },
  );
}
