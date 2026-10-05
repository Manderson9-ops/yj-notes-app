import { describe, expect, it } from "vitest";
import {
  ApiError,
  NetworkError,
  type AnswerUpload,
  type AskClient,
  type ClaimedQuestion,
} from "./client.ts";
import { ClaudeError } from "./claude.ts";
import { goodAnswer } from "./fixtures.ts";
import {
  backoffMs,
  failCodeOf,
  handleOne,
  runLoop,
  type LoopDeps,
  type Processor,
} from "./loop.ts";
import type { LogFields } from "./logger.ts";
import type { PipelineResult } from "./pipeline.ts";

const Q: ClaimedQuestion = {
  id: 3,
  body: "비밀 질문 본문 테스트아이",
  askedBy: "테스트",
  createdAt: "2020-03-01T00:00:00Z",
  redFlag: false,
};

const RESULT: PipelineResult = {
  level: 4,
  answer: goodAnswer(),
  reviewScore: 9.6,
  rubric: { evidence: 3, records: 2, actionable: 2, safety: 1.5, tone: 1.5 },
  model: "opus",
  workMs: 10,
  rewrites: 0,
  rewritten: false,
  timings: { total: 10 },
  packTokens: 10,
};

interface Rec {
  calls: string[];
  uploads: AnswerUpload[];
  logs: { event: string; fields?: LogFields | undefined }[];
}

function make(opts: {
  claims?: (ClaimedQuestion | null | Error)[];
  processor?: Processor;
  answerErrors?: Error[];
}): { deps: LoopDeps; rec: Rec; ac: AbortController } {
  const rec: Rec = { calls: [], uploads: [], logs: [] };
  const ac = new AbortController();
  const claims = [...(opts.claims ?? [])];
  const answerErrors = [...(opts.answerErrors ?? [])];
  const client: AskClient = {
    claim() {
      rec.calls.push("claim");
      const c = claims.shift();
      if (c === undefined) {
        ac.abort();
        return Promise.resolve(null);
      }
      return c instanceof Error ? Promise.reject(c) : Promise.resolve(c);
    },
    progress(id, status) {
      rec.calls.push(`progress:${id}:${status}`);
      return Promise.resolve();
    },
    answer(id, body) {
      const e = answerErrors.shift();
      if (e) return Promise.reject(e);
      rec.calls.push(`answer:${id}`);
      rec.uploads.push(body);
      return Promise.resolve();
    },
    fail(id, code) {
      rec.calls.push(`fail:${id}:${code}`);
      return Promise.resolve();
    },
    ping: () => Promise.resolve(),
  };
  const sleeps: number[] = [];
  const deps: LoopDeps = {
    client,
    process:
      opts.processor ??
      (async (_q, hooks) => {
        await hooks.onAnswering?.();
        await hooks.onReviewing?.();
        return RESULT;
      }),
    log: (event, fields) => rec.logs.push({ event, fields }),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    pollMs: 10_000,
    heartbeatMs: 0,
    backoffBaseMs: 100,
    backoffMaxMs: 400,
  };
  (rec as Rec & { sleeps: number[] }).sleeps = sleeps;
  return { deps, rec, ac };
}

describe("handleOne", () => {
  it("claim → progress answering → reviewing → answer 업로드", async () => {
    const { deps, rec, ac } = make({ claims: [Q] });
    const r = await handleOne(deps, ac.signal);
    expect(r.claimed).toBe(true);
    expect(rec.calls).toEqual([
      "claim",
      "progress:3:answering",
      "progress:3:reviewing",
      "answer:3",
    ]);
    expect(rec.uploads[0]).toMatchObject({ level: 4, reviewScore: 9.6, model: "opus" });
    expect(typeof rec.uploads[0]?.workMs).toBe("number");
  });

  it("처리 실패는 fail(code) 로 보고한다", async () => {
    const { deps, rec, ac } = make({
      claims: [Q],
      processor: () => Promise.reject(new ClaudeError("claude_exit")),
    });
    await handleOne(deps, ac.signal);
    expect(rec.calls).toEqual(["claim", "fail:3:claude_exit"]);
  });

  it("알 수 없는 예외는 internal_error", async () => {
    const { deps, rec, ac } = make({
      claims: [Q],
      processor: () => Promise.reject(new Error("질문 내용 포함 메시지")),
    });
    await handleOne(deps, ac.signal);
    expect(rec.calls).toContain("fail:3:internal_error");
  });

  it("업로드 네트워크 오류는 재시도한다", async () => {
    const { deps, rec, ac } = make({
      claims: [Q],
      answerErrors: [new NetworkError(), new NetworkError()],
    });
    await handleOne(deps, ac.signal);
    expect(rec.calls.filter((c) => c.startsWith("answer"))).toEqual(["answer:3"]);
    expect(rec.calls.some((c) => c.startsWith("fail"))).toBe(false);
  });

  it("업로드가 422 로 거절되면 fail(upload_422)", async () => {
    const { deps, rec, ac } = make({ claims: [Q], answerErrors: [new ApiError(422)] });
    await handleOne(deps, ac.signal);
    expect(rec.calls).toContain("fail:3:upload_422");
  });

  it("claim 네트워크 오류는 netError 로 알린다", async () => {
    const { deps, ac } = make({ claims: [new NetworkError()] });
    expect(await handleOne(deps, ac.signal)).toEqual({ claimed: false, netError: true });
  });

  it("중단 신호 중 처리하던 질문은 worker_stopped 로 반환한다", async () => {
    const { deps, rec, ac } = make({
      claims: [Q],
      processor: () => {
        ac.abort();
        return Promise.reject(new ClaudeError("aborted"));
      },
    });
    await handleOne(deps, ac.signal);
    expect(rec.calls).toContain("fail:3:worker_stopped");
  });

  it("로그에 질문·답변 본문이 없다", async () => {
    const { deps, rec, ac } = make({ claims: [Q] });
    await handleOne(deps, ac.signal);
    const dump = JSON.stringify(rec.logs);
    expect(dump).not.toContain("비밀 질문 본문");
    expect(dump).not.toContain(RESULT.answer.summary);
    expect(rec.logs.map((l) => l.event)).toEqual(expect.arrayContaining(["claimed", "answered"]));
  });
});

describe("runLoop", () => {
  it("204(없음)면 pollMs 만큼 쉬고, 중단되면 종료", async () => {
    const { deps, rec, ac } = make({ claims: [null, null] });
    await runLoop(deps, ac.signal);
    expect((rec as Rec & { sleeps: number[] }).sleeps).toEqual([10_000, 10_000, 10_000]);
    expect(rec.logs.at(-1)?.event).toBe("loop_stop");
  });

  it("질문을 처리한 직후엔 쉬지 않고 바로 다시 claim", async () => {
    const { deps, rec, ac } = make({ claims: [Q, { ...Q, id: 4 }] });
    await runLoop(deps, ac.signal);
    expect(rec.calls.filter((c) => c === "claim").length).toBe(3);
    expect((rec as Rec & { sleeps: number[] }).sleeps).toEqual([10_000]);
  });

  it("네트워크 오류는 지수 백오프(상한)하고 성공하면 초기화", async () => {
    const { deps, rec, ac } = make({
      claims: [
        new NetworkError(),
        new NetworkError(),
        new NetworkError(),
        new NetworkError(),
        null,
      ],
    });
    await runLoop(deps, ac.signal);
    expect((rec as Rec & { sleeps: number[] }).sleeps).toEqual([
      100, 200, 400, 400, 10_000, 10_000,
    ]);
  });
});

describe("helpers", () => {
  it("backoffMs", () => {
    expect([1, 2, 3, 10].map((n) => backoffMs(n))).toEqual([2000, 4000, 8000, 60000]);
  });
  it("failCodeOf", () => {
    expect(failCodeOf(new ApiError(500))).toBe("upload_500");
    expect(failCodeOf(new Error("x"))).toBe("internal_error");
  });
});
