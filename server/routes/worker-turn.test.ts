// 워커 API 의 대화 턴(T-Q5): claim 합치기·thread·플래그, 턴 progress/reply/card/fail, 잠금·한도·시도 회계. 합성 문구만(테스트아이).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rows,
  sessionCall,
  syntheticAnswer,
  syntheticFollowup,
  workerAnswerBody,
  workerCall,
  workerReplyBody,
} from "../test-utils/ask";
import { ClaimTurnResponseSchema, type ClaimTurnResponse } from "../../shared/ask-schema";
import { TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";
import { ASK_RATE } from "./ask";
import { LEASE_MS, MAX_ATTEMPTS } from "./worker";

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = await createHarness();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cookie = cookieFrom(await h.login(TEST_PIN));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const app = (method: string, path: string, json?: unknown) =>
  sessionCall(h, cookie, method, path, json);
const sql = (s: string, ...args: (string | number | null)[]) =>
  h.fake.sqlite.prepare(s).run(...args);
const claim = () => workerCall(h, "POST", "/api/worker/ask/claim");
const turnPath = (tid: number, leaf: string) => `/api/worker/ask/turn/${String(tid)}/${leaf}`;
const post = (tid: number, leaf: string, json?: unknown) =>
  workerCall(h, "POST", turnPath(tid, leaf), json);

async function claimTurn(): Promise<ClaimTurnResponse> {
  const res = await claim();
  expect(res.status).toBe(200);
  return ClaimTurnResponseSchema.parse(await res.json());
}

/** 질문 하나를 끝까지 만든다(카드 게시). */
async function doneQuestion(body = "합성 질문", askedBy = "엄마"): Promise<number> {
  h.clock.t += 1000;
  const id = (await (await app("POST", "/api/ask", { body, askedBy })).json<{ id: number }>()).id;
  expect((await claim()).status).toBe(200);
  const res = await workerCall(
    h,
    "POST",
    `/api/worker/ask/${String(id)}/answer`,
    workerAnswerBody(5),
  );
  expect(res.status).toBe(200);
  return id;
}

/** 후속 턴을 앱 API 로 만든다. */
async function followup(id: number, body = "합성 후속", by = "엄마"): Promise<number> {
  h.clock.t += ASK_RATE.windowMs + 1000;
  const res = await app("POST", `/api/ask/${String(id)}/turn`, { body, askedBy: by });
  expect(res.status).toBe(201);
  return (await res.json<{ id: number }>()).id;
}

interface TurnRow {
  status: string;
  attempts: number;
  lease_until: string | null;
  claimed_at: string | null;
  fail_code: string | null;
  reply_json: string | null;
  review_score: number | null;
  reply_model: string | null;
  work_ms: number | null;
  wait_ms: number | null;
  total_ms: number | null;
  replied_at: string | null;
  card_status: string;
  card_note: string | null;
  card_reason: string | null;
  card_attempts: number;
  card_lease_until: string | null;
  card_fail_code: string | null;
  card_version: number | null;
  card_model: string | null;
  card_work_ms: number | null;
}
const turnRow = (tid: number): TurnRow | undefined =>
  rows<TurnRow>(h, `SELECT * FROM ask_turn WHERE id = ${String(tid)}`)[0];

/** 후속 턴을 만들고 짧은 답까지 확정해 카드 단계(card_status='pending')로 보낸다. */
async function toCardStage(id: number, over: Parameters<typeof workerReplyBody>[0] = {}) {
  const tid = await followup(id);
  const c = await claimTurn();
  expect(c.turn.id).toBe(tid);
  const res = await post(
    tid,
    "reply",
    workerReplyBody({
      cardWanted: true,
      cardReason: "합성 이유",
      reply: syntheticFollowup({ cardUpdate: { needed: true, reason: "합성 이유" } }),
      ...over,
    }),
  );
  expect(await res.json()).toEqual({ status: "done", cardStatus: "pending" });
  return tid;
}

describe("claim — 질문·턴 합치기", () => {
  it("턴 응답: 최상위 question 없이 type·stage·cardUpdatesLeft·redLock·turn·thread, 집으면 claimed", async () => {
    const id = await doneQuestion("테스트아이가 자꾸 던져요", "엄마");
    const tid = await followup(id, "오늘도 그랬어요", "아빠");
    const raw = await (await claim()).json<Record<string, unknown>>();
    expect(raw).not.toHaveProperty("question");
    const c = ClaimTurnResponseSchema.parse(raw);
    expect(c).toMatchObject({
      type: "turn",
      stage: "reply",
      cardUpdatesLeft: 3,
      redLock: false,
      turn: {
        id: tid,
        seq: 1,
        kind: "followup",
        body: "오늘도 그랬어요",
        redFlag: false,
        reaskReason: null,
        askedBy: "아빠",
        reply: null,
        cardReason: null,
      },
      thread: {
        question: { id, body: "테스트아이가 자꾸 던져요", askedBy: "엄마", redFlag: false },
        turns: [],
      },
    });
    expect(c.turn.reask).toBeUndefined();
    expect(c.thread.card).toEqual(syntheticAnswer(5));
    expect(turnRow(tid)).toMatchObject({
      status: "claimed",
      attempts: 1,
      lease_until: new Date(h.clock.t + LEASE_MS).toISOString(),
      claimed_at: new Date(h.clock.t).toISOString(),
    });
    expect((await claim()).status).toBe(204); // 리스가 살아 있는 동안은 다시 집히지 않는다
  });

  it("질문 응답에는 type:'question' 이 더해지고 그 밖은 그대로다", async () => {
    h.clock.t += 1000;
    const id = (
      await (
        await app("POST", "/api/ask", { body: "합성 질문", askedBy: "엄마" })
      ).json<{
        id: number;
      }>()
    ).id;
    const j = await (await claim()).json<Record<string, unknown>>();
    expect(j).toEqual({
      type: "question",
      question: {
        id,
        body: "합성 질문",
        askedBy: "엄마",
        createdAt: new Date(h.clock.t).toISOString(),
        redFlag: false,
      },
    });
  });

  it("ASK_TURN_CLAIM=0: 턴은 고르지 않고 질문 응답 모양은 type 없이 예전과 같다", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    h.env.ASK_TURN_CLAIM = "0";
    expect((await claim()).status).toBe(204);
    expect(turnRow(tid)).toMatchObject({ status: "pending", attempts: 0 });
    h.clock.t += 1000;
    await app("POST", "/api/ask", { body: "새 질문", askedBy: "엄마" });
    const j = await (await claim()).json<Record<string, unknown>>();
    expect(Object.keys(j)).toEqual(["question"]);
    // 다시 켜면(값 없음·"1") 쌓인 턴이 처리된다
    h.env.ASK_TURN_CLAIM = "1";
    expect((await claimTurn()).turn.id).toBe(tid);
    delete h.env.ASK_TURN_CLAIM;
    expect((await claim()).status).toBe(204);
  });

  it("정렬: 위급 우선 → 오래된 순, 두 표를 가로질러 겨룬다", async () => {
    const q1 = await doneQuestion("첫 질문");
    const t1 = await followup(q1, "먼저 온 후속"); // 가장 오래된 턴
    h.clock.t += 1000;
    const q2 = (
      await (
        await app("POST", "/api/ask", { body: "나중 질문", askedBy: "아빠" })
      ).json<{
        id: number;
      }>()
    ).id; // 턴보다 늦은 일반 질문
    h.clock.t += 1000;
    const q3 = (
      await (
        await app("POST", "/api/ask", { body: "경련을 했어요", askedBy: "아빠" })
      ).json<{
        id: number;
      }>()
    ).id; // 가장 늦지만 위급 질문
    // 위급 질문 → 오래된 턴 → 일반 질문
    const first = await (await claim()).json<{ question?: { id: number } }>();
    expect(first.question?.id).toBe(q3);
    expect((await claimTurn()).turn.id).toBe(t1);
    const third = await (await claim()).json<{ question?: { id: number } }>();
    expect(third.question?.id).toBe(q2);
    expect((await claim()).status).toBe(204);
  });

  it("정렬: 더 오래된 일반 질문이 일반 턴보다 먼저, 위급 턴은 모든 일반 건보다 먼저", async () => {
    const q1 = await doneQuestion("첫 질문");
    h.clock.t += 1000;
    const q2 = (
      await (
        await app("POST", "/api/ask", { body: "대기 질문", askedBy: "아빠" })
      ).json<{
        id: number;
      }>()
    ).id;
    const t1 = await followup(q1, "나중 후속"); // 질문 q2 보다 늦다
    h.clock.t += 1000;
    const red = (
      await (
        await app("POST", `/api/ask/${String(q1)}/turn`, {
          body: "경련을 했어요",
          askedBy: "엄마",
        })
      ).json<{ id: number }>()
    ).id; // t1 이 활성이어도 위급은 받는다 — 가장 늦다
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      const j = await (
        await claim()
      ).json<{
        question?: { id: number };
        turn?: { id: number };
      }>();
      order.push(j.question ? `q${String(j.question.id)}` : `t${String(j.turn?.id)}`);
    }
    expect(order).toEqual([`t${String(red)}`, `q${String(q2)}`, `t${String(t1)}`]);
  });

  it("thread: 지금 턴 앞의 최근 10턴(seq 순, 위급·reask 포함), 이전 짧은 답과 이유를 싣는다", async () => {
    const id = await doneQuestion();
    const reply = syntheticFollowup({ reply: "합성 이전 답" });
    for (let seq = 1; seq <= 12; seq++) {
      const isReask = seq === 12;
      sql(
        `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, reask_reason, red_flag, status, reply_json, card_status, created_at, updated_at)
         VALUES (?, ?, ?, '엄마', ?, ?, ?, 'done', ?, 'none', ?, ?)`,
        id,
        seq,
        isReask ? "reask" : "followup",
        isReask ? "" : `합성 후속 ${String(seq)}`,
        isReask ? "이미 해 봤어요" : null,
        seq === 5 ? 1 : 0,
        seq === 4 ? "{broken" : JSON.stringify(reply),
        "2000-01-01T00:00:00.000Z",
        "2000-01-01T00:00:00.000Z",
      );
    }
    h.clock.t += 1000;
    sql(
      `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, status, card_status, created_at, updated_at)
       VALUES (?, 13, 'followup', '아빠', '지금 후속', 'pending', 'none', ?, ?)`,
      id,
      new Date(h.clock.t).toISOString(),
      new Date(h.clock.t).toISOString(),
    );
    const c = await claimTurn();
    expect(c.turn.seq).toBe(13);
    expect(c.thread.turns).toHaveLength(10);
    expect(c.thread.turns.map((t) => t.body)).toEqual([
      "합성 후속 3",
      "합성 후속 4",
      "합성 후속 5",
      "합성 후속 6",
      "합성 후속 7",
      "합성 후속 8",
      "합성 후속 9",
      "합성 후속 10",
      "합성 후속 11",
      "",
    ]);
    expect(c.thread.turns[0]).toMatchObject({ by: "엄마", kind: "followup", reply });
    expect(c.thread.turns[1]?.reply).toBeNull(); // 깨진 짧은 답은 null
    expect(c.thread.turns[9]).toMatchObject({ kind: "reask", reaskReason: "이미 해 봤어요" });
  });

  it("reask 턴(카드 단계): reask 덩어리에 횟수·이유·이전 카드가 오고 reply 는 null", async () => {
    const id = await doneQuestion();
    h.clock.t += 1000;
    const res = await app("POST", `/api/ask/${String(id)}/reask`, {
      by: "아빠",
      choice: "우리 상황과 달라요",
      text: "합성 사정이 있어요",
    });
    expect(res.status).toBe(200);
    const c = await claimTurn();
    expect(c).toMatchObject({
      stage: "card",
      cardUpdatesLeft: 3,
      turn: {
        kind: "reask",
        body: "합성 사정이 있어요",
        reaskReason: "우리 상황과 달라요 · 합성 사정이 있어요",
        askedBy: "아빠",
        reply: null,
        reask: {
          count: 1,
          reason: "우리 상황과 달라요 · 합성 사정이 있어요",
          by: "아빠",
        },
      },
    });
    expect(c.turn.reask?.previousAnswer).toEqual(syntheticAnswer(5));
    expect(turnRow(c.turn.id)).toMatchObject({ card_attempts: 1, status: "done", attempts: 0 });
  });

  it("지운 질문의 턴은 집지 않고, 원자적으로 한 번만 잡힌다", async () => {
    const id = await doneQuestion();
    await followup(id);
    const results = await Promise.all(Array.from({ length: 8 }, () => claim()));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rows<{ attempts: number }>(h, "SELECT attempts FROM ask_turn")[0]?.attempts).toBe(1);

    sql("UPDATE ask_turn SET status = 'done'"); // 첫 턴은 끝난 것으로
    const id2 = await doneQuestion("둘째 질문");
    await followup(id2);
    await app("DELETE", `/api/ask/${String(id2)}`);
    expect((await claim()).status).toBe(204);
  });

  it("카드 단계: 짧은 답 뒤 다음 claim 이 집고, 리스 안에서는 다시 집히지 않으며 만료되면 다시(시도 +1)", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    expect(turnRow(tid)).toMatchObject({
      status: "done",
      card_status: "pending",
      card_attempts: 0,
    });
    const c = await claimTurn();
    expect(c).toMatchObject({
      stage: "card",
      turn: {
        id: tid,
        reply: syntheticFollowup({ cardUpdate: { needed: true, reason: "합성 이유" } }),
        cardReason: "합성 이유",
      },
    });
    expect(turnRow(tid)).toMatchObject({
      card_attempts: 1,
      card_lease_until: new Date(h.clock.t + LEASE_MS).toISOString(),
    });
    expect((await claim()).status).toBe(204);
    h.clock.t += LEASE_MS + 1000;
    expect((await claimTurn()).turn.id).toBe(tid);
    expect(turnRow(tid)?.card_attempts).toBe(2);
  });

  it("짧은 답 단계 리스가 만료되면 다시 집히고, 3번 끝나면 failed(too_many_attempts), 카드도 같다", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await claimTurn()).turn.id).toBe(tid);
      h.clock.t += LEASE_MS + 1000;
    }
    expect((await claim()).status).toBe(204);
    expect(turnRow(tid)).toMatchObject({
      status: "failed",
      fail_code: "too_many_attempts",
      lease_until: null,
    });

    const id2 = await doneQuestion("둘째 질문");
    const tid2 = await toCardStage(id2);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await claimTurn()).turn.id).toBe(tid2);
      h.clock.t += LEASE_MS + 1000;
    }
    expect((await claim()).status).toBe(204);
    expect(turnRow(tid2)).toMatchObject({
      status: "done",
      card_status: "failed",
      card_fail_code: "too_many_attempts",
      card_lease_until: null,
    });
    // 짧은 답은 남는다
    expect(turnRow(tid2)?.reply_json).not.toBeNull();
  });

  it("잠금 정리: 잠긴 질문의 일반 턴 카드 대기는 집지 않고 redlock 으로 닫는다(위급 턴은 집는다)", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    sql("UPDATE ask_question SET red_lock = 1"); // 짧은 답 뒤 다른 경로로 잠금이 켜진 경우(정리 batch 를 놓친 행)
    expect((await claim()).status).toBe(204);
    expect(turnRow(tid)).toMatchObject({ card_status: "none", card_note: "redlock" });
    // 위급 턴은 잠긴 질문에서도 카드 단계로 집힌다
    h.clock.t += ASK_RATE.windowMs + 1000;
    const red = await (
      await app("POST", `/api/ask/${String(id)}/turn`, { body: "경련을 했어요", askedBy: "엄마" })
    ).json<{ id: number }>();
    const c = await claimTurn();
    expect(c).toMatchObject({ stage: "card", redLock: true, turn: { id: red.id, redFlag: true } });
    sql("UPDATE ask_turn SET card_status = 'done' WHERE red_flag = 1");
    // 잠금 정리와 3회 닫기가 한 행에 겹치면 잠금 정리가 먼저(failed 가 아니라 none/redlock)
    const id3 = await doneQuestion("셋째 질문");
    const tid3 = await toCardStage(id3);
    sql("UPDATE ask_turn SET card_attempts = 3 WHERE id = ?", tid3);
    sql("UPDATE ask_question SET red_lock = 1 WHERE id = ?", id3);
    await claim();
    expect(turnRow(tid3)).toMatchObject({ card_status: "none", card_note: "redlock" });
  });

  it("바로 다시 집힌다: 턴 /fail 뒤 냉각 없이 같은 claim 에서 다시 잡힌다", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    await claimTurn();
    const res = await post(tid, "fail", { stage: "reply", code: "claude_error" });
    expect(await res.json()).toEqual({ status: "pending", cardStatus: "none" });
    expect(turnRow(tid)).toMatchObject({ fail_code: "claude_error", lease_until: null });
    expect((await claimTurn()).turn.id).toBe(tid);
    expect(turnRow(tid)?.attempts).toBe(2);
  });
});

describe("POST /api/worker/ask/turn/:tid/progress", () => {
  it("짧은 답 단계: 상태를 바꾸고 리스를 5분 연장한다(수락 = 집은 뒤의 진행 상태)", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    expect((await post(tid, "progress", { stage: "reply", status: "answering" })).status).toBe(409); // 아직 pending
    await claimTurn();
    h.clock.t += 4 * 60_000;
    expect((await post(tid, "progress", { stage: "reply", status: "reviewing" })).status).toBe(204);
    expect(turnRow(tid)).toMatchObject({
      status: "reviewing",
      lease_until: new Date(h.clock.t + LEASE_MS).toISOString(),
    });
  });

  it("카드 단계 하트비트: 카드 리스만 연장하고 status 는 done 으로 둔다, 짧은 답 progress 는 409", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    await claimTurn();
    h.clock.t += 4 * 60_000;
    expect((await post(tid, "progress", { stage: "card" })).status).toBe(204);
    expect(turnRow(tid)).toMatchObject({
      status: "done",
      card_status: "pending",
      card_lease_until: new Date(h.clock.t + LEASE_MS).toISOString(),
      lease_until: null,
    });
    expect((await post(tid, "progress", { stage: "reply", status: "answering" })).status).toBe(409);
    // 카드 단계가 끝난 턴에 card 하트비트는 409
    sql("UPDATE ask_turn SET card_status = 'done'");
    expect((await post(tid, "progress", { stage: "card" })).status).toBe(409);
  });

  it("검증 422, 없는 번호·잘못된 번호·지운 질문의 턴은 404", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    await claimTurn();
    expect((await post(tid, "progress", { status: "answering" })).status).toBe(422);
    expect((await post(tid, "progress", { stage: "reply", status: "done" })).status).toBe(422);
    expect((await post(tid, "progress", { stage: "card", extra: 1 })).status).toBe(422);
    expect((await post(9999, "progress", { stage: "card" })).status).toBe(404);
    expect(
      (await workerCall(h, "POST", "/api/worker/ask/turn/abc/progress", { stage: "card" })).status,
    ).toBe(404);
    await app("DELETE", `/api/ask/${String(id)}`);
    expect((await post(tid, "progress", { stage: "reply", status: "answering" })).status).toBe(404);
  });

  it("progress·reply 는 워커 생존 표시를 갱신하고, card 는 갱신하지 않는다", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    await claimTurn();
    const seen = () =>
      rows<{ value: string }>(
        h,
        "SELECT value FROM app_setting WHERE key = 'ask_worker_seen_at'",
      )[0]?.value;
    h.clock.t += 5 * 60_000;
    expect(seen()).not.toBe(new Date(h.clock.t).toISOString());
    await post(tid, "progress", { stage: "reply", status: "answering" });
    expect(seen()).toBe(new Date(h.clock.t).toISOString());
    h.clock.t += 5 * 60_000;
    await post(tid, "reply", workerReplyBody({ cardWanted: true, cardReason: "합성" }));
    expect(seen()).toBe(new Date(h.clock.t).toISOString());
    // 카드 단계 하트비트는 갱신하고, /card 업로드는 갱신하지 않는다
    await claimTurn();
    h.clock.t += 5 * 60_000;
    await post(tid, "progress", { stage: "card" });
    expect(seen()).toBe(new Date(h.clock.t).toISOString());
    h.clock.t += 5 * 60_000;
    await post(tid, "card", workerAnswerBody(6));
    expect(seen()).not.toBe(new Date(h.clock.t).toISOString());
  });
});

describe("POST /api/worker/ask/turn/:tid/reply", () => {
  it("저장하고 done, 카드가 필요 없으면 card_status='none'(cardSkip 은 card_note 로)", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    h.clock.t += 20_000;
    await claimTurn(); // 대기 20s
    await post(tid, "progress", { stage: "reply", status: "reviewing" });
    h.clock.t += 30_000;
    const res = await post(
      tid,
      "reply",
      workerReplyBody({ cardWanted: false, cardSkip: "limit", reviewScore: 9.7 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done", cardStatus: "none" });
    expect(turnRow(tid)).toMatchObject({
      status: "done",
      reply_json: JSON.stringify(syntheticFollowup()),
      review_score: 9.7,
      reply_model: "sonnet-synthetic",
      work_ms: 8000,
      wait_ms: 20_000,
      total_ms: 50_000,
      replied_at: new Date(h.clock.t).toISOString(),
      lease_until: null,
      card_status: "none",
      card_note: "limit",
      card_reason: null,
      card_attempts: 0,
      card_lease_until: null,
    });
  });

  it("카드가 필요하면 pending 으로 두고 카드 리스·시도는 건드리지 않는다(cardReason 저장)", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    expect(turnRow(tid)).toMatchObject({
      card_status: "pending",
      card_note: null,
      card_reason: "합성 이유",
      card_attempts: 0,
      card_lease_until: null,
    });
  });

  it("서버가 같은 UPDATE 에서 잠금을 다시 본다: 짧은 답을 만드는 동안 잠금이 켜지면 cardWanted 여도 none/redlock", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    await claimTurn();
    sql("UPDATE ask_question SET red_lock = 1"); // 위급 후속이 그사이 들어왔다
    const res = await post(tid, "reply", workerReplyBody({ cardWanted: true, cardReason: "합성" }));
    expect(await res.json()).toEqual({ status: "done", cardStatus: "none" });
    expect(turnRow(tid)).toMatchObject({ card_status: "none", card_note: "redlock" });
    // red_flag 만 켜진 질문(마이그레이션 사이에 생긴 위급 질문)도 잠긴 것으로 본다
    const id2 = await doneQuestion("둘째 질문");
    const tid2 = await followup(id2);
    await claimTurn();
    sql("UPDATE ask_question SET red_flag = 1 WHERE id = ?", id2);
    await post(tid2, "reply", workerReplyBody({ cardWanted: true, cardReason: "합성" }));
    expect(turnRow(tid2)).toMatchObject({ card_status: "none", card_note: "redlock" });
  });

  it("reviewScore:null 은 422(T-Q4b 의 미검토 확정은 아직 받지 않는다), 금지어·모르는 키·잘못된 숫자도 422", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    await claimTurn();
    expect((await post(tid, "reply", { ...workerReplyBody(), reviewScore: null })).status).toBe(
      422,
    );
    expect((await post(tid, "reply", { ...workerReplyBody(), reviewScore: 11 })).status).toBe(422);
    expect((await post(tid, "reply", { ...workerReplyBody(), extra: 1 })).status).toBe(422);
    const noCardWanted: Record<string, unknown> = { ...workerReplyBody() };
    delete noCardWanted.cardWanted;
    expect((await post(tid, "reply", noCardWanted)).status).toBe(422);
    const forbidden = await post(
      tid,
      "reply",
      workerReplyBody({ reply: syntheticFollowup({ reply: "이건 정상 범위가 아니에요" }) }),
    );
    expect(forbidden.status).toBe(422);
    expect(await forbidden.json()).toMatchObject({
      error: "validation_error",
      code: "forbidden_word",
    });
    expect(turnRow(tid)?.status).toBe("claimed"); // 거절된 업로드는 아무것도 바꾸지 않는다
  });

  it("진행 중이 아니면 409(대기·완료 뒤 두 번째), 지운 질문·없는 번호는 404, 한 번만 저장", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    expect((await post(tid, "reply", workerReplyBody())).status).toBe(409); // 아직 pending
    await claimTurn();
    expect((await post(tid, "reply", workerReplyBody())).status).toBe(200);
    const again = await post(tid, "reply", workerReplyBody({ model: "other" }));
    expect(again.status).toBe(409);
    expect(turnRow(tid)?.reply_model).toBe("sonnet-synthetic");
    expect((await post(9999, "reply", workerReplyBody())).status).toBe(404);
    const id2 = await doneQuestion("둘째 질문");
    const tid2 = await followup(id2);
    await claimTurn();
    await app("DELETE", `/api/ask/${String(id2)}`);
    expect((await post(tid2, "reply", workerReplyBody())).status).toBe(404);
  });
});

describe("POST /api/worker/ask/turn/:tid/card", () => {
  it("현재 카드를 이력으로 옮기고 같은 행을 UPDATE 한다(카드가 비는 순간 없음), 시간 열은 첫 답 값, card_updates+1", async () => {
    const id = await doneQuestion();
    const before = rows<{ wait_ms: number; work_ms: number; total_ms: number; created_at: string }>(
      h,
      "SELECT wait_ms, work_ms, total_ms, created_at FROM ask_answer",
    )[0];
    const tid = await toCardStage(id);
    await claimTurn();
    h.clock.t += 60_000;
    const res = await post(
      tid,
      "card",
      workerAnswerBody(7, { summary: "합성 새 카드 요약이에요", levelReason: "합성 새 이유예요" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done", cardVersion: 2 });
    const [a] = rows<{
      level: number;
      review_score: number;
      model: string;
      created_at: string;
      wait_ms: number;
      work_ms: number;
      total_ms: number;
      answer_json: string;
    }>(h, "SELECT * FROM ask_answer");
    expect(a).toMatchObject({
      level: 7,
      review_score: 9.6,
      model: "opus-synthetic",
      created_at: new Date(h.clock.t).toISOString(),
      wait_ms: before?.wait_ms,
      work_ms: before?.work_ms,
      total_ms: before?.total_ms,
    });
    expect(a?.answer_json).toContain("합성 새 카드 요약이에요");
    const hist = rows<{ version: number; level: number; created_at: string }>(
      h,
      "SELECT version, level, created_at FROM ask_answer_history",
    );
    expect(hist).toEqual([{ version: 1, level: 5, created_at: before?.created_at }]);
    expect(turnRow(tid)).toMatchObject({
      card_status: "done",
      card_version: 2,
      card_model: "opus-synthetic",
      card_work_ms: 42_000,
      card_note: null,
      card_lease_until: null,
    });
    expect(rows<{ card_updates: number }>(h, "SELECT card_updates FROM ask_question")[0]).toEqual({
      card_updates: 1,
    });
    // 상세: 현재 카드는 answer, 이전 카드는 history, 질문은 내내 done
    const d = await (
      await app("GET", `/api/ask/${String(id)}`)
    ).json<{
      status: string;
      answer: { level: number };
      history: { version: number }[];
      threadActive: boolean;
      cardUpdates: { used: number };
      turns: { cardVersion: number | null; cardStatus: string }[];
    }>();
    expect(d).toMatchObject({
      status: "done",
      answer: { level: 7 },
      history: [{ version: 1 }],
      threadActive: false,
      cardUpdates: { used: 1 },
      turns: [{ cardVersion: 2, cardStatus: "done" }],
    });
    // 두 번째 갱신: 이력 2, 카드 번호 3
    const tid2 = await toCardStage(id);
    await claimTurn();
    const res2 = await post(tid2, "card", workerAnswerBody(8));
    expect(await res2.json()).toEqual({ status: "done", cardVersion: 3 });
    expect(
      rows<{ version: number }>(h, "SELECT version FROM ask_answer_history ORDER BY version"),
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("두 번 올려도 한 번만(409), 카드 대기가 아닌 턴은 409, 지운 질문은 404, 없는 번호는 404", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    expect((await post(tid, "card", workerAnswerBody(6))).status).toBe(200);
    expect((await post(tid, "card", workerAnswerBody(7))).status).toBe(409);
    expect(rows(h, "SELECT 1 FROM ask_answer_history")).toHaveLength(1);
    expect(rows<{ level: number }>(h, "SELECT level FROM ask_answer")[0]?.level).toBe(6);
    const tid2 = await followup(id, "다른 후속"); // 짧은 답도 안 끝난 턴
    expect((await post(tid2, "card", workerAnswerBody(6))).status).toBe(409);
    await app("DELETE", `/api/ask/${String(id)}`);
    expect((await post(tid2, "card", workerAnswerBody(6))).status).toBe(404);
    expect((await post(9999, "card", workerAnswerBody(6))).status).toBe(404);
  });

  it("409 로 거절할 때는 아무것도 쓰지 않는다: 붙일 카드(ask_answer)가 없으면 card_updates 도 늘지 않는다", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    h.fake.sqlite.prepare("DELETE FROM ask_answer WHERE question_id = ?").run(id);
    expect((await post(tid, "card", workerAnswerBody(6))).status).toBe(409);
    expect(
      rows<{ card_updates: number }>(h, "SELECT card_updates FROM ask_question")[0]?.card_updates,
    ).toBe(0);
    expect(turnRow(tid)?.card_status).toBe("pending");
  });

  it("422 형식 → 나머지 422(level_mismatch·forbidden_word)는 카드 대기 상태를 바꾸지 않는다", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    expect((await post(tid, "card", { level: 6 })).status).toBe(422);
    expect((await post(tid, "card", { ...workerAnswerBody(6), reviewScore: null })).status).toBe(
      422,
    );
    const mismatch = await post(tid, "card", { ...workerAnswerBody(6), level: 5 });
    expect(await mismatch.json()).toMatchObject({ code: "level_mismatch" });
    const forbidden = await post(
      tid,
      "card",
      workerAnswerBody(6, { summary: "정상 범위의 행동이에요" }),
    );
    expect(forbidden.status).toBe(422);
    expect(await forbidden.json()).toMatchObject({ code: "forbidden_word" });
    expect(turnRow(tid)?.card_status).toBe("pending");
  });

  it("위급 잠금: 일반 턴이 10단계가 아닌 카드를 올리면 422 redflag_level 이고 none/redlock 으로 기록", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    sql("UPDATE ask_question SET red_lock = 1");
    const res = await post(tid, "card", workerAnswerBody(5));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "validation_error", code: "redflag_level" });
    expect(turnRow(tid)).toMatchObject({ card_status: "none", card_note: "redlock" });
    expect(rows(h, "SELECT 1 FROM ask_answer_history")).toHaveLength(0);
    // 이미 정리된 턴의 늦은 업로드는 409(서버는 아무것도 쓰지 않는다)
    expect((await post(tid, "card", workerAnswerBody(10))).status).toBe(409);
  });

  it("위급 잠금: 위급 턴이 10단계가 아닌 카드를 올리면 422 이고 기록하지 않는다(워커가 /fail 로 센다)", async () => {
    const id = await doneQuestion();
    h.clock.t += ASK_RATE.windowMs + 1000;
    const red = (
      await (
        await app("POST", `/api/ask/${String(id)}/turn`, { body: "경련을 했어요", askedBy: "엄마" })
      ).json<{
        id: number;
      }>()
    ).id;
    const bad = await post(red, "card", workerAnswerBody(5));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "redflag_level" });
    expect(turnRow(red)).toMatchObject({ card_status: "pending", card_note: null });
    // 10단계 카드는 받는다. 위급 갱신은 card_updates 를 세지 않는다
    const ok = await post(red, "card", workerAnswerBody(10));
    expect(ok.status).toBe(200);
    expect(
      rows<{ card_updates: number }>(h, "SELECT card_updates FROM ask_question")[0]?.card_updates,
    ).toBe(0);
    expect(rows<{ level: number }>(h, "SELECT level FROM ask_answer")[0]?.level).toBe(10);
  });

  it("잠금 뒤 일반 턴이 10단계 카드를 올리는 경우는 batch 조건에서 409(카드를 덮어쓰지 못한다)", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    sql("UPDATE ask_question SET red_lock = 1");
    const res = await post(tid, "card", workerAnswerBody(10));
    expect(res.status).toBe(409);
    expect(rows<{ level: number }>(h, "SELECT level FROM ask_answer")[0]?.level).toBe(5);
    expect(rows(h, "SELECT 1 FROM ask_answer_history")).toHaveLength(0);
    expect(turnRow(tid)?.card_status).toBe("pending"); // 정리는 다음 claim 의 닫기 단계가 한다
  });

  it("카드 갱신 3번을 쓴 질문의 일반 턴은 429 card_limit 이고 none/limit 으로 기록, 위급 갱신은 이력이 이어진다", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    sql("UPDATE ask_question SET card_updates = 3, reask_count = 3");
    const res = await post(tid, "card", workerAnswerBody(6));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "card_limit" });
    expect(turnRow(tid)).toMatchObject({ card_status: "none", card_note: "limit" });
    expect(rows<{ level: number }>(h, "SELECT level FROM ask_answer")[0]?.level).toBe(5);
    // 짧은 답은 그대로 남아 있다
    expect(turnRow(tid)?.reply_json).not.toBeNull();
    // reask 3회 뒤의 위급 갱신: 한도와 무관하게 이력 이동이 일어난다(reask_count 조건을 두지 않는다)
    h.clock.t += ASK_RATE.windowMs + 1000;
    const red = (
      await (
        await app("POST", `/api/ask/${String(id)}/turn`, { body: "경련을 했어요", askedBy: "엄마" })
      ).json<{
        id: number;
      }>()
    ).id;
    expect((await post(red, "card", workerAnswerBody(10))).status).toBe(200);
    expect(rows<{ version: number }>(h, "SELECT version FROM ask_answer_history")).toEqual([
      { version: 1 },
    ]);
    expect(
      rows<{ card_updates: number }>(h, "SELECT card_updates FROM ask_question")[0]?.card_updates,
    ).toBe(3);
  });
});

describe("POST /api/worker/ask/turn/:tid/fail", () => {
  it("짧은 답 단계: 시도가 남으면 pending, 3번째는 failed(fail_code 기록), 진행 중이 아니면 409", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    expect((await post(tid, "fail", { stage: "reply", code: "x_code" })).status).toBe(409);
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await claimTurn();
      const res = await post(tid, "fail", { stage: "reply", code: "low_score" });
      expect(await res.json()).toEqual({
        status: i < MAX_ATTEMPTS ? "pending" : "failed",
        cardStatus: "none",
      });
    }
    expect(turnRow(tid)).toMatchObject({
      status: "failed",
      fail_code: "low_score",
      lease_until: null,
    });
    expect((await claim()).status).toBe(204);
  });

  it("카드 단계: 짧은 답은 유지한 채 카드만 다시 집힌다, 3번째는 card_status='failed' + card_fail_code", async () => {
    const id = await doneQuestion();
    const tid = await toCardStage(id);
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await claimTurn();
      const res = await post(tid, "fail", { stage: "card", code: "low_score" });
      expect(await res.json()).toEqual({
        status: "done",
        cardStatus: i < MAX_ATTEMPTS ? "pending" : "failed",
      });
      if (i < MAX_ATTEMPTS) expect(turnRow(tid)?.card_lease_until).toBeNull(); // 냉각 없이 바로 다시 집힌다
    }
    expect(turnRow(tid)).toMatchObject({
      status: "done",
      card_status: "failed",
      card_fail_code: "low_score",
      card_attempts: 3,
    });
    expect(turnRow(tid)?.reply_json).not.toBeNull();
    expect((await claim()).status).toBe(204);
    // 현재 카드는 그대로
    expect(rows<{ level: number }>(h, "SELECT level FROM ask_answer")[0]?.level).toBe(5);
    // 카드가 끝난 턴이라 다음 후속을 받는다
    h.clock.t += ASK_RATE.windowMs + 1000;
    expect(
      (await app("POST", `/api/ask/${String(id)}/turn`, { body: "다음 후속", askedBy: "엄마" }))
        .status,
    ).toBe(201);
  });

  it("위급 턴의 카드가 3번 실패하면 failed → overview 의 redUnhandled 1", async () => {
    const id = await doneQuestion();
    h.clock.t += ASK_RATE.windowMs + 1000;
    const red = (
      await (
        await app("POST", `/api/ask/${String(id)}/turn`, { body: "경련을 했어요", askedBy: "엄마" })
      ).json<{
        id: number;
      }>()
    ).id;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const c = await claimTurn();
      expect(c).toMatchObject({ stage: "card", turn: { id: red, redFlag: true } });
      await post(red, "fail", { stage: "card", code: "claude_error" });
    }
    expect(turnRow(red)?.card_status).toBe("failed");
    const ov = await (
      await app("GET", "/api/overview")
    ).json<{ ask: { redUnhandled: number; pending: number } }>();
    expect(ov.ask).toMatchObject({ redUnhandled: 1, pending: 0 });
    const d = await (
      await app("GET", `/api/ask/${String(id)}`)
    ).json<{
      redLock: boolean;
      turns: { redFlag: boolean; cardStatus: string }[];
    }>();
    expect(d.redLock).toBe(true);
    expect(d.turns[0]).toMatchObject({ redFlag: true, cardStatus: "failed" });
  });

  it("검증: stage 누락·잘못된 code → 422, 없는 번호 409, 형식 오류 404", async () => {
    const id = await doneQuestion();
    const tid = await followup(id);
    await claimTurn();
    expect((await post(tid, "fail", { code: "x" })).status).toBe(422);
    expect((await post(tid, "fail", { stage: "reply", code: "Bad Code" })).status).toBe(422);
    expect((await post(tid, "fail", { stage: "draft", code: "x" })).status).toBe(422);
    expect((await post(9999, "fail", { stage: "reply", code: "x" })).status).toBe(409);
    expect(
      (await workerCall(h, "POST", "/api/worker/ask/turn/abc/fail", { stage: "reply", code: "x" }))
        .status,
    ).toBe(404);
  });
});

describe("턴 워커 API — 인증·민감 정보", () => {
  it("Bearer 가 없거나 틀리면 401, 세션 쿠키로는 들어올 수 없다", async () => {
    for (const leaf of ["progress", "reply", "card", "fail"]) {
      expect((await workerCall(h, "POST", turnPath(1, leaf), {}, null)).status).toBe(401);
      expect(
        (await workerCall(h, "POST", turnPath(1, leaf), {}, "wrong-token-0123456789abcdef")).status,
      ).toBe(401);
      expect((await app("POST", turnPath(1, leaf), {})).status).toBe(401);
    }
  });

  it("오류 응답과 서버 로그에 가족 글이 없다", async () => {
    const spy = vi.spyOn(console, "error");
    const id = await doneQuestion();
    const tid = await followup(id, "아주 특이한 합성 문장 XYZ");
    await claimTurn();
    h.fake.failWith(new Error("D1 boom"));
    const res = await post(tid, "progress", { stage: "reply", status: "answering" });
    h.fake.failWith(null);
    expect(res.status).toBe(500);
    const all = JSON.stringify(await res.json()) + JSON.stringify(spy.mock.calls);
    expect(all).not.toContain("XYZ");
    const bad = await post(tid, "reply", { ...workerReplyBody(), reviewScore: null });
    expect(JSON.stringify(await bad.json())).not.toContain("합성");
  });
});
