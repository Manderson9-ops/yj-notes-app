// T-Q4a: 실패 종류 exitKind — 정규식 분류, 가짜 claude 로 세 경로(stderr·is_error 봉투·비정상 종료의 stdout 봉투) × 4종,
// auth 면 재실행하지 않는 withExitRetry, 시험 호출(시간 상한 → other).
import { describe, expect, it } from "vitest";
import {
  classifyExit,
  ClaudeError,
  createClaudeRunner,
  createProbe,
  PROBE_TIMEOUT_MS,
  withExitRetry,
  type ExitKind,
} from "./claude.ts";
import { KIND_TEXT, makeFakeClaude } from "./fake-claude.ts";

const KINDS: ExitKind[] = ["usage_limit", "auth", "overloaded", "other"];
const req = { prompt: "합성", systemPromptFile: "s.md", schemaJson: "{}" };

describe("classifyExit", () => {
  it("4종을 가른다(문구가 바뀌면 other)", () => {
    for (const k of KINDS) expect(classifyExit(KIND_TEXT[k])).toBe(k);
    expect(classifyExit("OAuth token has expired. Please obtain a new token")).toBe("auth");
    expect(classifyExit('API Error: 401 {"type":"authentication_error"}')).toBe("auth");
    expect(classifyExit("You've hit your limit · resets 3pm")).toBe("usage_limit");
    expect(classifyExit('API Error: 429 {"type":"rate_limit_error"}')).toBe("usage_limit");
    expect(classifyExit("")).toBe("other");
  });
  it("auth 가 다른 종류보다 이긴다", () => {
    expect(classifyExit(`${KIND_TEXT.overloaded}\n${KIND_TEXT.auth}`)).toBe("auth");
  });
});

describe("가짜 claude: 세 경로 × 4종", () => {
  const fake = makeFakeClaude();
  const run = createClaudeRunner({
    bin: fake.bin,
    argsPrefix: fake.argsPrefix,
    home: fake.home,
    timeoutMs: 10_000,
  });
  const paths = [
    ["stderr", "claude_exit"],
    ["is_error", "claude_error"],
    ["exit_envelope", "claude_exit"],
  ] as const;
  for (const [path, code] of paths) {
    it(`${path} → ${code} + exitKind`, async () => {
      for (const k of KINDS) {
        fake.setPlan([`${path}:${KIND_TEXT[k]}`]);
        const err = await run(req).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(ClaudeError);
        expect(err).toMatchObject({ code, exitKind: k });
      }
    });
  }
  it("성공은 그대로, 시간 초과는 exitKind 없음", async () => {
    fake.setPlan(["ok"]);
    await expect(run(req)).resolves.toMatchObject({ output: { ok: true }, model: "fake-model" });
    fake.setPlan(["hang"]);
    const short = createClaudeRunner({
      bin: fake.bin,
      argsPrefix: fake.argsPrefix,
      home: fake.home,
      timeoutMs: 300,
    });
    await expect(short(req)).rejects.toMatchObject({ code: "timeout", exitKind: undefined });
  });
});

describe("withExitRetry 의 auth 생략", () => {
  const count = (kind: ExitKind) => {
    let n = 0;
    return {
      run: () => {
        n++;
        return Promise.reject(new ClaudeError("claude_exit", kind));
      },
      n: () => n,
    };
  };
  it("ASK_AUTH_PAUSE=1(skipAuth): auth 는 재실행하지 않고, 그 밖은 1회 재실행", async () => {
    const a = count("auth");
    await expect(withExitRetry(a.run, 0, true)(req)).rejects.toMatchObject({ exitKind: "auth" });
    expect(a.n()).toBe(1);
    const u = count("usage_limit");
    await expect(withExitRetry(u.run, 0, true)(req)).rejects.toThrow("claude_exit");
    expect(u.n()).toBe(2);
  });
  it("ASK_AUTH_PAUSE=0: auth 도 지금처럼 1회 재실행", async () => {
    const a = count("auth");
    await expect(withExitRetry(a.run, 0, false)(req)).rejects.toThrow("claude_exit");
    expect(a.n()).toBe(2);
  });
});

describe("시험 호출(createProbe)", () => {
  const fake = makeFakeClaude();
  const probeWith = (timeoutMs: number) =>
    createProbe(
      createClaudeRunner({
        bin: fake.bin,
        argsPrefix: fake.argsPrefix,
        home: fake.home,
        timeoutMs,
      }),
      { model: "sonnet", systemPromptFile: "probe.md" },
    );
  it("성공·auth·usage_limit·시간 초과(other)", async () => {
    expect(PROBE_TIMEOUT_MS).toBe(60_000);
    fake.setPlan(["ok", `stderr:${KIND_TEXT.auth}`, `is_error:${KIND_TEXT.usage_limit}`]);
    const p = probeWith(10_000);
    expect(await p()).toEqual({ ok: true });
    expect(await p()).toEqual({ ok: false, kind: "auth" });
    expect(await p()).toEqual({ ok: false, kind: "usage_limit" });
    fake.setPlan(["hang"]);
    expect(await probeWith(300)()).toEqual({ ok: false, kind: "other" });
  });
});
