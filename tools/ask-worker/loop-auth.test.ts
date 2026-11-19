// T-Q4a: auth 일시정지(가짜 claude 스크립트로 처리·시험 호출 모두 실제 자식 프로세스) + 폴링 3s(가짜 시계).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskClient, ClaimedQuestion } from "./client.ts";
import { createClaudeRunner, createProbe, withExitRetry } from "./claude.ts";
import { loadConfig } from "./config.ts";
import { KIND_TEXT, makeFakeClaude, type FakeClaude } from "./fake-claude.ts";
import { goodAnswer } from "./fixtures.ts";
import { abortableSleep, AUTH_RETRY_MS, PROBE_RETRY_MS, runLoop, type LoopDeps } from "./loop.ts";
import type { PipelineResult } from "./pipeline.ts";
import { makeProbe } from "./worker.ts";

const q = (id: number): ClaimedQuestion => ({
  id,
  body: "합성 질문 테스트아이",
  askedBy: "테스트",
  createdAt: "2020-03-01T00:00:00Z",
  redFlag: false,
});

const RESULT: PipelineResult = {
  level: 4,
  answer: goodAnswer(),
  reviewScore: 9.6,
  deductions: {
    factual: 0,
    ungrounded: 0,
    safety: 0,
    template: 0,
    record_link: 0,
    over_interpretation: 0,
    recall: 0,
    style: 0,
  },
  issues: [],
  model: "opus",
  workMs: 1,
  rewrites: 0,
  rewritten: false,
  timings: {},
  packTokens: 1,
};

const TOKEN = "x".repeat(32);
const cfgFile = (text: string): string => {
  const f = join(mkdtempSync(join(tmpdir(), "yj-cfg-auth-")), "worker.env");
  writeFileSync(f, `APP_ORIGIN=https://a.example.test\nASK_WORKER_TOKEN=${TOKEN}\n${text}`);
  return f;
};

/** 시간 순 기록: claim·fail·answer 호출과 로그 이벤트, 쉬기(ms). */
function harness(
  fake: FakeClaude,
  claims: (ClaimedQuestion | null)[],
  o: { pause: boolean; probeTimeoutMs?: number },
) {
  const timeline: string[] = [];
  const ac = new AbortController();
  const left = [...claims];
  const client: AskClient = {
    claim() {
      timeline.push("claim");
      const c = left.shift();
      if (c === undefined) {
        ac.abort();
        return Promise.resolve(null);
      }
      return Promise.resolve(c);
    },
    progress: () => Promise.resolve(),
    answer(id) {
      timeline.push(`answer:${String(id)}`);
      return Promise.resolve();
    },
    fail(id, code) {
      timeline.push(`fail:${String(id)}:${code}`);
      return Promise.resolve();
    },
    turnProgress: () => Promise.resolve(),
    turnReply: () => Promise.resolve({ cardStatus: null }),
    turnCard: () => Promise.resolve(),
    turnFail: () => Promise.resolve(),
    history: () => Promise.resolve([]),
    ping: () => Promise.resolve(),
  };
  const runner = (timeoutMs: number) =>
    createClaudeRunner({ bin: fake.bin, argsPrefix: fake.argsPrefix, home: fake.home, timeoutMs });
  const work = withExitRetry(runner(10_000), 0, o.pause);
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];
  const deps: LoopDeps = {
    client,
    process: async (_q, _hooks, signal) => {
      await work({ prompt: "합성", systemPromptFile: "s.md", schemaJson: "{}" }, signal);
      return RESULT;
    },
    log: (event, fields) => {
      timeline.push(event);
      logs.push({ event, ...(fields ? { fields } : {}) });
    },
    sleep: (ms) => {
      timeline.push(`sleep:${String(ms)}`);
      return Promise.resolve();
    },
    pollMs: 3000,
    heartbeatMs: 0,
    ...(o.pause
      ? {
          probe: createProbe(runner(o.probeTimeoutMs ?? 10_000), {
            model: "sonnet",
            systemPromptFile: "probe.md",
          }),
        }
      : {}),
  };
  return { deps, ac, timeline, logs };
}

const between = (t: string[], a: string, b: string): string[] =>
  t.slice(t.indexOf(a) + 1, t.indexOf(b));

describe("auth 일시정지 (가짜 claude)", () => {
  it("처리 중 auth → claude_exit 로 fail·exitKind 기록 → 일시정지 중 claim 0회 → 해제 시험 성공 시 재개, 루프는 끝나지 않는다", async () => {
    const fake = makeFakeClaude();
    // 시작 시험 ok → 1번 처리 auth(재실행 없음) → 해제 시험 auth → 해제 시험 ok → 2번 처리 ok
    fake.setPlan(["ok", `stderr:${KIND_TEXT.auth}`, `stderr:${KIND_TEXT.auth}`, "ok", "ok"]);
    const h = harness(fake, [q(1), q(2)], { pause: true });
    await runLoop(h.deps, h.ac.signal);
    expect(fake.calls()).toHaveLength(5); // auth 는 withExitRetry 가 다시 돌리지 않는다
    expect(h.logs.find((l) => l.event === "failed")?.fields).toMatchObject({
      id: 1,
      code: "claude_exit",
      exitKind: "auth",
    });
    expect(h.timeline).toContain("fail:1:claude_exit");
    const paused = between(h.timeline, "auth_paused", "auth_resumed");
    expect(paused).toEqual([`sleep:${String(AUTH_RETRY_MS)}`, `sleep:${String(AUTH_RETRY_MS)}`]);
    expect(paused).not.toContain("claim");
    expect(h.timeline.slice(h.timeline.indexOf("auth_resumed"))).toEqual(
      expect.arrayContaining(["claim", "answer:2"]),
    );
    expect(h.timeline.at(-1)).toBe("loop_stop");
    expect(AUTH_RETRY_MS).toBe(600_000);
  });

  it("규칙 1: 시작 시험이 성공하기 전에는 claim 0회(시작 시험이 auth 면 일시정지부터)", async () => {
    const fake = makeFakeClaude();
    fake.setPlan([`is_error:${KIND_TEXT.auth}`, "ok"]);
    const h = harness(fake, [null], { pause: true });
    await runLoop(h.deps, h.ac.signal);
    const first = h.timeline.indexOf("claim");
    expect(h.timeline.indexOf("auth_resumed")).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(h.timeline.indexOf("auth_resumed"));
    expect(h.timeline.slice(0, first)).toEqual([
      "loop_start",
      "auth_paused",
      `sleep:${String(AUTH_RETRY_MS)}`,
      "auth_resumed",
    ]);
  });

  it("규칙 2: 시작 시험이 auth 아닌 실패면 일시정지 없이 60s 뒤 재시험, 그동안 claim 0회", async () => {
    const fake = makeFakeClaude();
    fake.setPlan([
      `stderr:${KIND_TEXT.usage_limit}`,
      `exit_envelope:${KIND_TEXT.overloaded}`,
      "ok",
    ]);
    const h = harness(fake, [null], { pause: true });
    await runLoop(h.deps, h.ac.signal);
    expect(PROBE_RETRY_MS).toBe(60_000);
    expect(h.timeline.slice(0, h.timeline.indexOf("claim"))).toEqual([
      "loop_start",
      "probe_failed",
      "sleep:60000",
      "probe_failed",
      "sleep:60000",
    ]);
    expect(h.timeline).not.toContain("auth_paused");
    expect(h.logs.filter((l) => l.event === "probe_failed").map((l) => l.fields)).toEqual([
      { exitKind: "usage_limit" },
      { exitKind: "overloaded" },
    ]);
  });

  it("규칙 3: 일시정지 중 시험이 auth 아닌 이유(사용량 한도·시간 초과)로 실패하면 풀리지 않는다", async () => {
    const fake = makeFakeClaude();
    // 시작 ok → 처리 auth → 해제 시험: usage_limit → 시간 초과 → ok
    fake.setPlan([
      "ok",
      `stderr:${KIND_TEXT.auth}`,
      `stderr:${KIND_TEXT.usage_limit}`,
      "hang",
      "ok",
    ]);
    const h = harness(fake, [q(1), null], { pause: true, probeTimeoutMs: 1500 });
    await runLoop(h.deps, h.ac.signal);
    const paused = between(h.timeline, "auth_paused", "auth_resumed");
    expect(paused).toEqual([
      `sleep:${String(AUTH_RETRY_MS)}`,
      `sleep:${String(AUTH_RETRY_MS)}`,
      `sleep:${String(AUTH_RETRY_MS)}`,
    ]);
    expect(fake.calls()).toEqual([
      "ok",
      `stderr:${KIND_TEXT.auth}`,
      `stderr:${KIND_TEXT.usage_limit}`,
      "hang",
      "ok",
    ]);
  });

  it("규칙 4: ASK_AUTH_PAUSE=0 이면 시험 없이 바로 claim, auth 도 지금처럼 재실행·일시정지 없음(exitKind 기록만)", async () => {
    const cfg = loadConfig({ file: cfgFile("ASK_AUTH_PAUSE=0\n"), env: {} });
    expect(cfg.authPause).toBe(false);
    expect(makeProbe(cfg)).toBeUndefined();
    expect(loadConfig({ file: cfgFile(""), env: {} }).authPause).toBe(true);
    expect(makeProbe(loadConfig({ file: cfgFile(""), env: {} }))).toBeTypeOf("function");

    const fake = makeFakeClaude();
    fake.setPlan([`stderr:${KIND_TEXT.auth}`, `stderr:${KIND_TEXT.auth}`, "ok"]);
    const h = harness(fake, [q(1), q(2)], { pause: false });
    await runLoop(h.deps, h.ac.signal);
    expect(h.timeline.slice(0, 2)).toEqual(["loop_start", "claim"]);
    expect(fake.calls()).toHaveLength(3); // 1번 질문: auth 1회 + 재실행 1회, 2번 질문: ok
    expect(h.timeline).not.toContain("auth_paused");
    expect(h.timeline).toEqual(expect.arrayContaining(["fail:1:claude_exit", "claim", "answer:2"]));
    expect(h.logs.find((l) => l.event === "failed")?.fields).toMatchObject({ exitKind: "auth" });
  });
});

describe("폴링 3s (가짜 시계)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("ASK_POLL_MS=3000 이면 빈 claim 사이 간격이 3s", async () => {
    vi.useFakeTimers();
    const cfg = loadConfig({ file: cfgFile("ASK_POLL_MS=3000\n"), env: {} });
    expect(cfg.pollMs).toBe(3000);
    const at: number[] = [];
    const ac = new AbortController();
    const client: AskClient = {
      claim() {
        at.push(Date.now());
        if (at.length === 4) ac.abort();
        return Promise.resolve(null);
      },
      progress: () => Promise.resolve(),
      answer: () => Promise.resolve(),
      fail: () => Promise.resolve(),
      turnProgress: () => Promise.resolve(),
      turnReply: () => Promise.resolve({ cardStatus: null }),
      turnCard: () => Promise.resolve(),
      turnFail: () => Promise.resolve(),
      history: () => Promise.resolve([]),
      ping: () => Promise.resolve(),
    };
    const done = runLoop(
      {
        client,
        process: () => Promise.resolve(RESULT),
        log: () => undefined,
        sleep: abortableSleep,
        pollMs: cfg.pollMs,
        heartbeatMs: 0,
      },
      ac.signal,
    );
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(at.slice(1).map((t, i) => t - (at[i] ?? 0))).toEqual([3000, 3000, 3000]);
  });
});
