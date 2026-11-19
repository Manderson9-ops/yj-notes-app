// T-Q5 루프의 턴 처리: 업로드 응답 표(턴 행)마다 1건, 하트비트 abort, 단계별 claim 종료, 냉각 없는 재claim.
// 가짜 클라이언트·가짜 처리기·가짜 claude 러너만 쓴다(합성 자료 테스트아이).
import { describe, expect, it } from "vitest";
import { TurnReplySchema, type TurnProgress } from "../../shared/ask-schema.ts";
import {
  ApiError,
  NetworkError,
  type AnswerUpload,
  type AskClient,
  type ClaimedQuestion,
  type ClaimedTurn,
} from "./client.ts";
import { ClaudeError, type ClaudeRequest, type ClaudeRunner } from "./claude.ts";
import { claimTurn, goodAnswer, goodFollowup, PACK, review } from "./fixtures.ts";
import type { FollowupResult } from "./followup.ts";
import { answerFollowup, cardQuestion } from "./followup.ts";
import { decideCard, handleOne, runLoop, type LoopDeps, type TurnProcessors } from "./loop.ts";
import type { LogFields } from "./logger.ts";
import { answerQuestion, type PipelineDeps, type PipelineResult } from "./pipeline.ts";

const ZERO = {
  factual: 0,
  ungrounded: 0,
  safety: 0,
  template: 0,
  record_link: 0,
  over_interpretation: 0,
  recall: 0,
  style: 0,
};
const REPLY: FollowupResult = {
  reply: goodFollowup(),
  reviewScore: 9.7,
  deductions: ZERO,
  issues: [],
  model: "opus",
  workMs: 10,
  rewrites: 0,
  rewritten: false,
  timings: { total: 10 },
  packTokens: 10,
};
const CARD: PipelineResult = {
  level: 4,
  answer: goodAnswer(),
  reviewScore: 9.6,
  deductions: ZERO,
  issues: [],
  model: "opus",
  workMs: 10,
  rewrites: 0,
  rewritten: false,
  timings: { total: 10 },
  packTokens: 10,
};

interface Rec {
  calls: string[];
  progress: TurnProgress[];
  replies: unknown[];
  cards: AnswerUpload[];
  fails: { stage: string; code: string }[];
  logs: { event: string; fields?: LogFields | undefined }[];
  sleeps: number[];
}
interface Queues {
  progress?: (Error | undefined)[];
  reply?: (Error | undefined)[];
  card?: (Error | undefined)[];
  fail?: (Error | undefined)[];
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function make(opts: {
  claims: (ClaimedQuestion | ClaimedTurn | null | Error)[];
  turn?: Partial<TurnProcessors>;
  errors?: Queues;
  heartbeatMs?: number;
  /** 하트비트(setInterval)의 progress 만 이 함수로 판정한다. */
  progressAlways?: (n: number) => Error | undefined;
  /** 확정 요청(/reply·/card)이 응답하기까지 걸리는 시간. */
  confirmDelayMs?: number;
}): { deps: LoopDeps; rec: Rec; ac: AbortController } {
  const rec: Rec = {
    calls: [],
    progress: [],
    replies: [],
    cards: [],
    fails: [],
    logs: [],
    sleeps: [],
  };
  const ac = new AbortController();
  const claims = [...opts.claims];
  const q = {
    progress: [...(opts.errors?.progress ?? [])],
    reply: [...(opts.errors?.reply ?? [])],
    card: [...(opts.errors?.card ?? [])],
    fail: [...(opts.errors?.fail ?? [])],
  };
  let progressN = 0;
  const reject = (e: Error | undefined) => (e ? Promise.reject(e) : Promise.resolve());
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
    history: () => Promise.resolve([]),
    progress: () => Promise.resolve(),
    answer: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    ping: () => Promise.resolve(),
    turnProgress(id, body) {
      progressN += 1;
      rec.calls.push(`turnProgress:${String(id)}`);
      rec.progress.push(body);
      return reject(opts.progressAlways ? opts.progressAlways(progressN) : q.progress.shift());
    },
    async turnReply(id, body) {
      rec.calls.push(`turnReply:${String(id)}`);
      rec.replies.push(body);
      await sleepMs(opts.confirmDelayMs ?? 0);
      await reject(q.reply.shift());
      return { cardStatus: body.cardWanted ? "pending" : "none" };
    },
    async turnCard(id, body) {
      rec.calls.push(`turnCard:${String(id)}`);
      rec.cards.push(body);
      await sleepMs(opts.confirmDelayMs ?? 0);
      await reject(q.card.shift());
    },
    turnFail(id, stage, code) {
      rec.calls.push(`turnFail:${String(id)}:${stage}:${code}`);
      rec.fails.push({ stage, code });
      return reject(q.fail.shift());
    },
  };
  const turn: TurnProcessors = {
    reply: opts.turn?.reply ?? (() => Promise.resolve(REPLY)),
    card: opts.turn?.card ?? (() => Promise.resolve(CARD)),
  };
  const deps: LoopDeps = {
    client,
    process: () => Promise.reject(new Error("질문 처리기는 호출되지 않는다")),
    turn,
    log: (event, fields) => rec.logs.push({ event, fields }),
    sleep: (ms) => {
      rec.sleeps.push(ms);
      return Promise.resolve();
    },
    pollMs: 10_000,
    heartbeatMs: opts.heartbeatMs ?? 0,
    backoffBaseMs: 100,
    backoffMaxMs: 400,
  };
  return { deps, rec, ac };
}

const events = (r: Rec) => r.logs.map((l) => l.event);
const logOf = (r: Rec, event: string) => r.logs.find((l) => l.event === event)?.fields;
const reply = (over: Parameters<typeof claimTurn>[0] = {}) =>
  claimTurn({ ...over, stage: "reply" });
const card = (over: Parameters<typeof claimTurn>[0] = {}) => claimTurn({ ...over, stage: "card" });

describe("decideCard: 카드 갱신 판단", () => {
  const c = (over: { redLock?: boolean; left?: number; red?: boolean }) => ({
    redLock: over.redLock ?? false,
    cardUpdatesLeft: over.left ?? 3,
    turn: { redFlag: over.red ?? false },
  });
  const needed = goodFollowup({ cardUpdate: { needed: true, reason: "새 기록" } });
  it("필요 없으면 이유도 없다", () => {
    expect(decideCard(c({}), goodFollowup())).toEqual({ cardWanted: false, cardSkip: null });
    expect(decideCard(c({ redLock: true, left: 0 }), goodFollowup())).toEqual({
      cardWanted: false,
      cardSkip: null,
    });
  });
  it("필요하고 남은 횟수가 있고 잠금이 아니면 카드를 이어 만든다", () => {
    expect(decideCard(c({}), needed)).toEqual({ cardWanted: true, cardSkip: null });
  });
  it("남은 횟수 0 → limit, 잠금 → redlock(둘 다면 잠금이 먼저)", () => {
    expect(decideCard(c({ left: 0 }), needed)).toEqual({ cardWanted: false, cardSkip: "limit" });
    expect(decideCard(c({ redLock: true }), needed)).toEqual({
      cardWanted: false,
      cardSkip: "redlock",
    });
    expect(decideCard(c({ redLock: true, left: 0 }), needed).cardSkip).toBe("redlock");
  });
  it("위급 턴은 잠금·한도를 받지 않는다", () => {
    expect(decideCard(c({ redLock: true, left: 0, red: true }), needed).cardWanted).toBe(true);
  });
});

describe("짧은 답 단계: claim 한 번에 한 단계", () => {
  it("progress(reply·answering→reviewing) → /reply 하고 그 claim 을 끝낸다(카드를 이어 돌지 않는다)", async () => {
    const { deps, rec, ac } = make({
      claims: [reply()],
      turn: {
        reply: async (_c, hooks) => {
          await hooks.onAnswering?.();
          hooks.onStage?.("generate", 5);
          await hooks.onReviewing?.();
          return {
            ...REPLY,
            reply: goodFollowup({ cardUpdate: { needed: true, reason: "새 지속 기간" } }),
          };
        },
      },
    });
    const r = await handleOne(deps, ac.signal);
    expect(r.claimed).toBe(true);
    expect(rec.calls).toEqual(["claim", "turnProgress:11", "turnProgress:11", "turnReply:11"]);
    expect(rec.progress).toEqual([
      { stage: "reply", status: "answering" },
      { stage: "reply", status: "reviewing" },
    ]);
    const body = TurnReplySchema.parse(rec.replies[0]); // 서버가 받는 모양 그대로
    expect(body).toMatchObject({
      reviewScore: 9.7,
      model: "opus",
      cardWanted: true,
      cardSkip: null,
      cardReason: "새 지속 기간",
    });
    expect(events(rec)).toEqual(["turn_claimed", "turn_stage", "turn_answered"]);
    expect(logOf(rec, "turn_claimed")).toEqual({ turnId: 11, stage: "reply", redFlag: false });
    expect(logOf(rec, "turn_stage")).toEqual({ turnId: 11, stage: "generate", ms: 5 });
    expect(logOf(rec, "turn_answered")).toMatchObject({
      turnId: 11,
      score: 9.7,
      cardWanted: true,
      cardStatus: "pending",
    });
    // 질문 쪽 이벤트 이름·번호 필드는 쓰지 않는다
    expect(rec.logs.every((l) => l.fields?.id === undefined)).toBe(true);
    expect(events(rec)).not.toContain("claimed");
  });

  it("잠금·한도면 카드를 요청하지 않고 cardSkip 으로 이유만 보낸다", async () => {
    const needed = { ...REPLY, reply: goodFollowup({ cardUpdate: { needed: true, reason: "r" } }) };
    for (const [c, skip] of [
      [reply({ redLock: true }), "redlock"],
      [reply({ cardUpdatesLeft: 0 }), "limit"],
    ] as const) {
      const { deps, rec, ac } = make({
        claims: [c],
        turn: { reply: () => Promise.resolve(needed) },
      });
      await handleOne(deps, ac.signal);
      expect(rec.replies[0]).toMatchObject({ cardWanted: false, cardSkip: skip });
    }
  });

  it("후속·카드 두 claim 은 따로: 같은 턴이 reply 뒤에 card 로 다시 claim 돼 /card 로 끝난다", async () => {
    const { deps, rec, ac } = make({ claims: [reply(), card()] });
    await runLoop(deps, ac.signal);
    expect(rec.calls.filter((c) => c !== "turnProgress:11")).toEqual([
      "claim",
      "turnReply:11",
      "claim",
      "turnCard:11",
      "claim",
    ]);
    expect(events(rec)).toContain("card_done");
  });
});

describe("카드 단계", () => {
  it("/card 업로드와 card_done, 진행 보고·하트비트는 stage:card 만(status 를 바꾸지 않는다)", async () => {
    const { deps, rec, ac } = make({
      claims: [card()],
      turn: {
        card: async (_c, hooks) => {
          await hooks.onAnswering?.();
          await hooks.onReviewing?.();
          return CARD;
        },
      },
    });
    await handleOne(deps, ac.signal);
    expect(rec.progress).toEqual([{ stage: "card" }, { stage: "card" }]);
    expect(rec.cards[0]).toMatchObject({ level: 4, reviewScore: 9.6, model: "opus" });
    expect(events(rec)).toEqual(["turn_claimed", "card_done"]);
    expect(logOf(rec, "turn_claimed")).toMatchObject({ stage: "card" });
    expect(logOf(rec, "card_done")).toMatchObject({ turnId: 11, level: 4, score: 9.6 });
  });

  it("하트비트 progress 는 claim 의 stage 로 고정된다(카드 claim 은 늘 {stage:card})", async () => {
    const hold = async () => {
      await sleepMs(40);
    };
    const c = make({
      claims: [card()],
      heartbeatMs: 5,
      turn: { card: async () => (await hold(), CARD) },
    });
    await handleOne(c.deps, c.ac.signal);
    expect(c.rec.progress.length).toBeGreaterThanOrEqual(2);
    expect(c.rec.progress.every((p) => p.stage === "card")).toBe(true);
    const r = make({
      claims: [reply()],
      heartbeatMs: 5,
      turn: { reply: async () => (await hold(), REPLY) },
    });
    await handleOne(r.deps, r.ac.signal);
    expect(r.rec.progress.length).toBeGreaterThanOrEqual(2);
    expect(r.rec.progress.every((p) => p.stage === "reply" && p.status === "answering")).toBe(true);
  });

  it("위급 턴 카드는 level 10 으로만 올라간다(워커 level=10, 응급 절은 턴 본문)", async () => {
    const reqs: ClaudeRequest[] = [];
    const script: unknown[] = [goodAnswer({ level: 4 }), goodAnswer({ level: 10 }), review()];
    const runClaude: ClaudeRunner = (req) => {
      reqs.push(req);
      return Promise.resolve({ output: script.shift(), ms: 1, model: "claude-opus-x" });
    };
    const pipe: PipelineDeps = {
      runClaude,
      buildPack: () => Promise.resolve(PACK),
      systemPromptFile: "s.md",
      reviewPromptFile: "r.md",
      answerSchemaJson: "{}",
      targetScore: 9.5,
      minPublishScore: 8.5,
    };
    const { deps, rec, ac } = make({
      claims: [
        card({ redLock: true, turn: { redFlag: true, body: "방금 경련을 했어요", reply: null } }),
      ],
      turn: { card: (c, hooks, signal) => answerQuestion(pipe, cardQuestion(c), hooks, signal) },
    });
    await handleOne(deps, ac.signal);
    expect(rec.cards[0]?.level).toBe(10);
    expect(reqs).toHaveLength(3);
    expect(logOf(rec, "turn_claimed")).toMatchObject({ redFlag: true });
    expect(events(rec)).toContain("card_done");
  });
});

describe("업로드 응답 표(턴 행)", () => {
  it("확정 요청 409 → 버림(turn_abandoned code 409), /fail 없음 — /reply·/card 모두", async () => {
    for (const [c, key] of [
      [reply(), "reply"],
      [card(), "card"],
    ] as const) {
      const { deps, rec, ac } = make({
        claims: [c],
        errors: { [key]: [new ApiError(409, "conflict")] },
      });
      const r = await handleOne(deps, ac.signal);
      expect(r).toEqual({ claimed: true, netError: false });
      expect(rec.fails).toEqual([]);
      expect(events(rec)).toEqual(["turn_claimed", "turn_abandoned"]);
      expect(logOf(rec, "turn_abandoned")).toEqual({ turnId: 11, stage: key, code: "409" });
    }
  });

  it("확정 요청 404(부모 질문 삭제) → 버림(code 404), /fail 없음", async () => {
    for (const [c, key] of [
      [reply(), "reply"],
      [card(), "card"],
    ] as const) {
      const { deps, rec, ac } = make({
        claims: [c],
        errors: { [key]: [new ApiError(404, "not_found")] },
      });
      await handleOne(deps, ac.signal);
      expect(rec.fails).toEqual([]);
      expect(logOf(rec, "turn_abandoned")).toMatchObject({ stage: key, code: "404" });
      expect(events(rec)).not.toContain("turn_failed");
    }
  });

  it("하트비트 409 → 작업 abort, /fail 없이 turn_abandoned(hb_409), 확정 요청도 안 나간다", async () => {
    let aborted = false;
    const { deps, rec, ac } = make({
      claims: [reply()],
      heartbeatMs: 5,
      progressAlways: () => new ApiError(409, "conflict"),
      turn: {
        reply: (_c, _h, signal) =>
          new Promise((_, rej) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                rej(new ClaudeError("aborted"));
              },
              { once: true },
            );
          }),
      },
    });
    await handleOne(deps, ac.signal);
    expect(aborted).toBe(true);
    expect(ac.signal.aborted).toBe(false); // 바깥 종료 signal 은 건드리지 않는다
    expect(rec.fails).toEqual([]);
    expect(rec.replies).toEqual([]);
    expect(logOf(rec, "turn_abandoned")).toEqual({ turnId: 11, stage: "reply", code: "hb_409" });
    expect(events(rec)).not.toContain("turn_failed");
  });

  it("하트비트 404 → hb_404 (카드 단계도 같다)", async () => {
    const { deps, rec, ac } = make({
      claims: [card()],
      heartbeatMs: 5,
      progressAlways: () => new ApiError(404, "not_found"),
      turn: {
        card: (_c, _h, signal) =>
          new Promise((_, rej) => {
            signal.addEventListener(
              "abort",
              () => {
                rej(new ClaudeError("aborted"));
              },
              { once: true },
            );
          }),
      },
    });
    await handleOne(deps, ac.signal);
    expect(logOf(rec, "turn_abandoned")).toEqual({ turnId: 11, stage: "card", code: "hb_404" });
    expect(rec.fails).toEqual([]);
  });

  it("하트비트의 그 밖의 오류(5xx·네트워크)는 무시하고 계속한다", async () => {
    const { deps, rec, ac } = make({
      claims: [reply()],
      heartbeatMs: 5,
      progressAlways: (n) => (n % 2 ? new ApiError(503) : new NetworkError()),
      turn: { reply: async () => (await sleepMs(40), REPLY) },
    });
    await handleOne(deps, ac.signal);
    expect(rec.replies).toHaveLength(1);
    expect(events(rec)).toContain("turn_answered");
    expect(events(rec)).not.toContain("turn_abandoned");
  });

  it("확정 요청이 이미 나간 뒤의 하트비트 409 는 abort 하지 않고 그 요청의 응답으로 판단한다", async () => {
    const { deps, rec, ac } = make({
      claims: [reply()],
      heartbeatMs: 5,
      progressAlways: () => new ApiError(409),
      confirmDelayMs: 40, // /reply 응답을 기다리는 동안 하트비트가 여러 번 409 를 받는다
      turn: { reply: () => Promise.resolve(REPLY) },
    });
    await handleOne(deps, ac.signal);
    expect(rec.progress.length).toBeGreaterThanOrEqual(2);
    expect(rec.replies).toHaveLength(1);
    expect(events(rec)).toContain("turn_answered");
    expect(events(rec)).not.toContain("turn_abandoned");
  });

  it("확정 요청이 나간 뒤 하트비트가 409 여도 그 요청의 응답(5xx)이 판단한다 → /fail", async () => {
    const { deps, rec, ac } = make({
      claims: [reply()],
      heartbeatMs: 5,
      progressAlways: () => new ApiError(409),
      confirmDelayMs: 40,
      errors: { reply: [new ApiError(503)] },
    });
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([{ stage: "reply", code: "upload_503" }]);
    expect(events(rec)).not.toContain("turn_abandoned");
  });

  it("진행 보고(하트비트 아님) 409·404 → 버림, 그 밖의 오류는 무시하고 계속", async () => {
    for (const status of [409, 404]) {
      const { deps, rec, ac } = make({
        claims: [reply()],
        errors: { progress: [new ApiError(status)] },
        turn: {
          reply: async (_c, hooks) => {
            await hooks.onAnswering?.();
            return REPLY;
          },
        },
      });
      await handleOne(deps, ac.signal);
      expect(rec.replies).toEqual([]);
      expect(rec.fails).toEqual([]);
      expect(logOf(rec, "turn_abandoned")).toMatchObject({ code: String(status) });
    }
    const ok = make({
      claims: [reply()],
      errors: { progress: [new ApiError(500)] },
      turn: {
        reply: async (_c, hooks) => {
          await hooks.onAnswering?.();
          return REPLY;
        },
      },
    });
    await handleOne(ok.deps, ok.ac.signal);
    expect(ok.rec.replies).toHaveLength(1);
  });

  it("/card 422 redflag_level: 일반 턴은 버림(redlock), /fail 없음", async () => {
    const { deps, rec, ac } = make({
      claims: [card()],
      errors: { card: [new ApiError(422, "redflag_level")] },
    });
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([]);
    expect(logOf(rec, "turn_abandoned")).toEqual({ turnId: 11, stage: "card", code: "redlock" });
  });

  it("/card 422 redflag_level: 위급 턴은 /fail(stage:card, code:redflag_level) + turn_failed", async () => {
    const { deps, rec, ac } = make({
      claims: [card({ redLock: true, turn: { redFlag: true } })],
      errors: { card: [new ApiError(422, "redflag_level")] },
    });
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([{ stage: "card", code: "redflag_level" }]);
    expect(events(rec)).toContain("turn_failed");
    expect(events(rec)).not.toContain("turn_abandoned");
    expect(logOf(rec, "turn_failed")).toMatchObject({
      stage: "card",
      code: "redflag_level",
      apiCode: "redflag_level",
    });
  });

  it("/card 429 card_limit → 버림(limit), 코드가 다른 429 는 실패", async () => {
    const lim = make({ claims: [card()], errors: { card: [new ApiError(429, "card_limit")] } });
    await handleOne(lim.deps, lim.ac.signal);
    expect(logOf(lim.rec, "turn_abandoned")).toMatchObject({ code: "limit" });
    expect(lim.rec.fails).toEqual([]);
    const other = make({ claims: [card()], errors: { card: [new ApiError(429, "too_many")] } });
    await handleOne(other.deps, other.ac.signal);
    expect(other.rec.fails).toEqual([{ stage: "card", code: "upload_429" }]);
  });

  it("그 밖의 422(검증·금지어·크기) → /fail(upload_422, 단계 포함), 세부 이유는 로그에만", async () => {
    for (const [c, key] of [
      [reply(), "reply"],
      [card(), "card"],
    ] as const) {
      const { deps, rec, ac } = make({
        claims: [c],
        errors: { [key]: [new ApiError(422, "forbidden_word")] },
      });
      await handleOne(deps, ac.signal);
      expect(rec.fails).toEqual([{ stage: key, code: "upload_422" }]);
      expect(logOf(rec, "turn_failed")).toMatchObject({
        code: "upload_422",
        apiCode: "forbidden_word",
      });
    }
  });

  it("네트워크 오류는 3번까지 다시 보내고, 그래도 실패하면 /fail", async () => {
    const ok = make({
      claims: [reply()],
      errors: { reply: [new NetworkError(), new NetworkError()] },
    });
    await handleOne(ok.deps, ok.ac.signal);
    expect(ok.rec.calls.filter((c) => c.startsWith("turnReply"))).toHaveLength(3);
    expect(ok.rec.fails).toEqual([]);
    expect(events(ok.rec)).toContain("turn_answered");
    expect(ok.rec.sleeps).toEqual([100, 200]);
    const bad = make({
      claims: [reply()],
      errors: { reply: [new NetworkError(), new NetworkError(), new NetworkError()] },
    });
    const r = await handleOne(bad.deps, bad.ac.signal);
    expect(r.netError).toBe(true);
    expect(bad.rec.fails).toEqual([{ stage: "reply", code: "internal_error" }]);
  });

  it("5xx·401 → /fail(upload_<상태>)", async () => {
    for (const status of [503, 401]) {
      const { deps, rec, ac } = make({
        claims: [card()],
        errors: { card: [new ApiError(status)] },
      });
      await handleOne(deps, ac.signal);
      expect(rec.fails).toEqual([{ stage: "card", code: `upload_${String(status)}` }]);
    }
  });

  it("/fail 자체가 실패해도 더 하지 않고 fail_report_error 만 남긴다", async () => {
    const { deps, rec, ac } = make({
      claims: [card()],
      errors: { card: [new ApiError(503)], fail: [new ApiError(409)] },
    });
    const r = await handleOne(deps, ac.signal);
    expect(r.claimed).toBe(true);
    expect(logOf(rec, "fail_report_error")).toEqual({ turnId: 11 });
  });
});

describe("처리 실패와 종료", () => {
  it("claude 실패는 단계와 함께 /fail, exitKind 만 로그(auth 면 일시정지 신호)", async () => {
    const { deps, rec, ac } = make({
      claims: [reply()],
      turn: { reply: () => Promise.reject(new ClaudeError("claude_exit", "auth")) },
    });
    const r = await handleOne(deps, ac.signal);
    expect(r.authFailed).toBe(true);
    expect(rec.fails).toEqual([{ stage: "reply", code: "claude_exit" }]);
    expect(logOf(rec, "turn_failed")).toMatchObject({
      turnId: 11,
      stage: "reply",
      exitKind: "auth",
    });
  });

  it("바깥 종료 signal 이면 worker_stopped(하트비트 abort 의 abandoned 와 구분)", async () => {
    const { deps, rec, ac } = make({
      claims: [card()],
      turn: {
        card: () => {
          ac.abort();
          return Promise.reject(new ClaudeError("aborted"));
        },
      },
    });
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([{ stage: "card", code: "worker_stopped" }]);
  });

  it("처리기가 없으면 internal_error 로 실패 보고", async () => {
    const { deps, rec, ac } = make({ claims: [reply()] });
    delete deps.turn;
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([{ stage: "reply", code: "internal_error" }]);
  });

  it("afterProcess 는 턴 처리(성공·버림·실패) 뒤에도 부른다", async () => {
    let n = 0;
    for (const errors of [
      undefined,
      { reply: [new ApiError(409)] },
      { reply: [new ApiError(503)] },
    ]) {
      const { deps, ac } = make({ claims: [reply()], ...(errors ? { errors } : {}) });
      deps.afterProcess = () => {
        n += 1;
        return Promise.resolve();
      };
      await handleOne(deps, ac.signal);
    }
    expect(n).toBe(3);
  });

  it("로그에 질문·답·대화 본문이 없다", async () => {
    const { deps, rec, ac } = make({
      claims: [reply({ turn: { body: "비밀 후속 질문 본문" } })],
      turn: {
        reply: () =>
          Promise.resolve({ ...REPLY, reply: goodFollowup({ reply: "비밀 짧은 답 본문" }) }),
      },
    });
    await handleOne(deps, ac.signal);
    const dump = JSON.stringify(rec.logs);
    expect(dump).not.toContain("비밀");
  });
});

describe("실제 파이프라인으로 돌리는 단계 실패", () => {
  function pipeline(script: unknown[]): PipelineDeps {
    const runClaude: ClaudeRunner = () => {
      const next = script.shift();
      return Promise.resolve({ output: next, ms: 1, model: "claude-opus-x" });
    };
    return {
      runClaude,
      buildPack: () => Promise.resolve(PACK),
      systemPromptFile: "s.md",
      reviewPromptFile: "r.md",
      answerSchemaJson: "{}",
      targetScore: 9.5,
      minPublishScore: 8.5,
      followup: { systemPromptFile: "f.md", reviewPromptFile: "fr.md", schemaJson: "{}" },
    };
  }

  it("짧은 답 재검토 미달 → low_score 로 /fail(stage:reply), /reply 는 나가지 않는다", async () => {
    const bad = review([{ category: "factual" }, { category: "factual" }]);
    const pipe = pipeline([goodFollowup(), bad, goodFollowup(), bad]);
    const { deps, rec, ac } = make({
      claims: [reply()],
      turn: { reply: (c, hooks, signal) => answerFollowup(pipe, c, hooks, signal) },
    });
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([{ stage: "reply", code: "low_score" }]);
    expect(rec.replies).toEqual([]);
    expect(logOf(rec, "turn_failed")).toMatchObject({ stage: "reply", code: "low_score" });
  });

  it("짧은 답이 통과하면 /reply 에 검토 점수·모델이 실린다", async () => {
    const pipe = pipeline([
      goodFollowup({ cardUpdate: { needed: true, reason: "새 기록이 있어요" } }),
      review(),
    ]);
    const { deps, rec, ac } = make({
      claims: [reply()],
      turn: { reply: (c, hooks, signal) => answerFollowup(pipe, c, hooks, signal) },
    });
    await handleOne(deps, ac.signal);
    expect(TurnReplySchema.parse(rec.replies[0])).toMatchObject({
      reviewScore: 10,
      model: "claude-opus-x",
      cardWanted: true,
      cardReason: "새 기록이 있어요",
    });
    expect(events(rec)).toEqual(expect.arrayContaining(["turn_stage", "turn_answered"]));
  });

  it("카드 검토 실패 → /fail(stage:card, review_invalid): 초안·미검토 게시 없이 시도 회계로", async () => {
    const pipe = pipeline([goodAnswer(), { nope: 1 }]);
    const { deps, rec, ac } = make({
      claims: [card()],
      turn: { card: (c, hooks, signal) => answerQuestion(pipe, cardQuestion(c), hooks, signal) },
    });
    await handleOne(deps, ac.signal);
    expect(rec.fails).toEqual([{ stage: "card", code: "review_invalid" }]);
    expect(rec.cards).toEqual([]);
  });

  it("턴 /fail 뒤 냉각 없이 바로 다시 claim 한다(쉬는 것은 빈 claim 한 번뿐)", async () => {
    const t = reply();
    const { deps, rec, ac } = make({
      claims: [t, t, t],
      turn: { reply: () => Promise.reject(new ClaudeError("claude_exit", "other")) },
    });
    await runLoop(deps, ac.signal);
    expect(rec.calls.filter((c) => c === "claim")).toHaveLength(4);
    expect(rec.fails).toHaveLength(3);
    expect(rec.sleeps).toEqual([10_000]);
  });
});
