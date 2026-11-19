// 물어보기 대화(T-Q5) 앱 API: 후속 질문(/turn)·위급 후속·한도·잠금·상세 새 필드·삭제·overview. 합성 문구만(테스트아이).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rows, sessionCall, workerAnswerBody, workerCall } from "../test-utils/ask";
import { ASK_TURN_MAX, FollowupSchema } from "../../shared/ask-schema";
import { TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";
import { ASK_RATE } from "./ask";
import { LEASE_MS } from "./worker";

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

const call = (method: string, path: string, json?: unknown) =>
  sessionCall(h, cookie, method, path, json);
const ask = (body: string, askedBy = "엄마") => call("POST", "/api/ask", { body, askedBy });
const turn = (id: number, body: string, askedBy = "엄마") =>
  call("POST", `/api/ask/${String(id)}/turn`, { body, askedBy });
const sql = (s: string, ...args: (string | number | null)[]) =>
  h.fake.sqlite.prepare(s).run(...args);

/** 질문 하나를 끝까지(접수 → 워커가 집음 → 카드 게시) 만든다. */
async function doneQuestion(body = "합성 질문", askedBy = "엄마"): Promise<number> {
  h.clock.t += 1000;
  const id = (await (await ask(body, askedBy)).json<{ id: number }>()).id;
  expect((await workerCall(h, "POST", "/api/worker/ask/claim")).status).toBe(200);
  const res = await workerCall(
    h,
    "POST",
    `/api/worker/ask/${String(id)}/answer`,
    workerAnswerBody(5),
  );
  expect(res.status).toBe(200);
  return id;
}

/** 열려 있는 턴을 모두 「짧은 답까지 끝나고 카드 없음」 상태로 만든다(다음 후속을 받을 수 있게). */
const settleTurns = (): void => {
  sql("UPDATE ask_turn SET status = 'done', card_status = 'none' WHERE status != 'failed'");
};

interface TurnView {
  id: number;
  seq: number;
  kind: string;
  askedBy: string;
  body: string;
  reaskReason: string | null;
  redFlag: boolean;
  status: string;
  reply: unknown;
  reviewScore: number | null;
  cardStatus: string;
  cardNote: string | null;
  cardVersion: number | null;
  createdAt: string;
  repliedAt: string | null;
}
interface Detail {
  status: string;
  workerOnline: boolean;
  threadActive: boolean;
  redLock: boolean;
  cardUpdates: { used: number; max: number };
  turnsUsed: number;
  originQuestionId: number | null;
  turns: TurnView[];
  reask: { count: number };
}
const detail = async (id: number): Promise<Detail> =>
  (await call("GET", `/api/ask/${String(id)}`)).json<Detail>();

describe("POST /api/ask/:id/turn — 일반 후속", () => {
  it("201 {id, seq, redFlag:false}: pending 턴이 생기고 질문은 done 으로 남는다", async () => {
    const id = await doneQuestion();
    h.clock.t += 5000;
    const res = await turn(id, "테스트아이가 오늘도 그래요", "아빠");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 1, seq: 1, redFlag: false });
    const [t] = rows<Record<string, unknown>>(h, "SELECT * FROM ask_turn");
    expect(t).toMatchObject({
      question_id: id,
      seq: 1,
      kind: "followup",
      asked_by: "아빠",
      body: "테스트아이가 오늘도 그래요",
      red_flag: 0,
      status: "pending",
      card_status: "none",
      reply_json: null,
      attempts: 0,
      card_attempts: 0,
      created_at: new Date(h.clock.t).toISOString(),
    });
    const d = await detail(id);
    expect(d.status).toBe("done");
    expect(d.threadActive).toBe(true);
    expect(d.turnsUsed).toBe(1);
    expect(d.turns[0]).toMatchObject({ seq: 1, kind: "followup", status: "pending", reply: null });
    settleTurns();
    h.clock.t += 5000;
    expect(await (await turn(id, "두 번째 후속")).json()).toEqual({
      id: 2,
      seq: 2,
      redFlag: false,
    });
  });

  it("검증: 빈 글·1001자·질문자 누락·모르는 키 → 422, 깨진 JSON → 400, 세션 없음 → 401", async () => {
    const id = await doneQuestion();
    expect((await turn(id, "   ")).status).toBe(422);
    expect((await turn(id, "가".repeat(1001))).status).toBe(422);
    expect((await call("POST", `/api/ask/${String(id)}/turn`, { body: "합성" })).status).toBe(422);
    expect(
      (await call("POST", `/api/ask/${String(id)}/turn`, { body: "합성", askedBy: "엄마", x: 1 }))
        .status,
    ).toBe(422);
    const bad = await h.handle(
      new Request(`https://app.example.test/api/ask/${String(id)}/turn`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://app.example.test",
          "Content-Type": "application/json",
        },
        body: "{oops",
      }),
    );
    expect(bad.status).toBe(400);
    const noSession = await h.handle(
      new Request(`https://app.example.test/api/ask/${String(id)}/turn`, {
        method: "POST",
        headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
        body: JSON.stringify({ body: "합성", askedBy: "엄마" }),
      }),
    );
    expect(noSession.status).toBe(401);
    expect(rows(h, "SELECT 1 FROM ask_turn")).toHaveLength(0);
  });

  it("422 는 DB 를 보기 전에: 없는 질문에 잘못된 본문이면 404 가 아니라 422", async () => {
    expect((await turn(999, "   ")).status).toBe(422);
    expect((await turn(999, "합성 후속")).status).toBe(404);
    expect(
      (await call("POST", "/api/ask/abc/turn", { body: "합성", askedBy: "엄마" })).status,
    ).toBe(404);
  });

  it("삭제된 질문은 404", async () => {
    const id = await doneQuestion();
    expect((await call("DELETE", `/api/ask/${String(id)}`)).status).toBe(204);
    expect((await turn(id, "합성 후속")).status).toBe(404);
  });

  it("질문이 done 이 아니면 409 question_busy(대기·실패)", async () => {
    const pending = (await (await ask("대기 중 질문")).json<{ id: number }>()).id;
    const res = await turn(pending, "합성 후속");
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toBe("question_busy");
    sql("UPDATE ask_question SET status = 'failed' WHERE id = ?", pending);
    expect((await turn(pending, "합성 후속")).status).toBe(409);
    expect(rows(h, "SELECT 1 FROM ask_turn")).toHaveLength(0);
  });

  it("활성 턴이 있으면 409 turn_active(짧은 답 단계·카드 단계 모두), 끝나면 다시 받는다", async () => {
    const id = await doneQuestion();
    expect((await turn(id, "첫 후속")).status).toBe(201);
    const busy = await turn(id, "둘째 후속");
    expect(busy.status).toBe(409);
    expect((await busy.json<{ error: string }>()).error).toBe("turn_active");
    // 짧은 답은 끝났지만 카드를 만드는 중
    sql("UPDATE ask_turn SET status = 'done', card_status = 'pending'");
    expect((await turn(id, "둘째 후속")).status).toBe(409);
    // 카드까지 끝나면 다시 받는다. 실패한 턴도 활성이 아니다
    sql("UPDATE ask_turn SET card_status = 'done'");
    h.clock.t += 1000;
    expect((await turn(id, "둘째 후속")).status).toBe(201);
    sql("UPDATE ask_turn SET status = 'failed' WHERE seq = 2");
    h.clock.t += 1000;
    expect((await turn(id, "셋째 후속")).status).toBe(201);
  });

  it("동시에 두 가족이 보내도 활성 턴은 하나만 생긴다", async () => {
    const id = await doneQuestion();
    const [a, b] = await Promise.all([turn(id, "첫 후속", "엄마"), turn(id, "다른 후속", "아빠")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(rows(h, "SELECT 1 FROM ask_turn")).toHaveLength(1);
  });

  it("후속 10번까지만: 11번째는 429 turn_limit(실패한 턴도 센다, 삭제된 턴은 뺀다)", async () => {
    const id = await doneQuestion();
    for (let i = 1; i <= ASK_TURN_MAX; i++) {
      h.clock.t += ASK_RATE.windowMs + 1000; // 레이트리밋과 겹치지 않게
      const res = await turn(id, `합성 후속 ${String(i)}`);
      expect(res.status).toBe(201);
      // 홀수 번째는 실패로, 짝수 번째는 정상 종료로 끝낸다
      sql(
        i % 2 === 1
          ? "UPDATE ask_turn SET status = 'failed' WHERE seq = ?"
          : "UPDATE ask_turn SET status = 'done', card_status = 'none' WHERE seq = ?",
        i,
      );
    }
    h.clock.t += ASK_RATE.windowMs + 1000;
    const res = await turn(id, "합성 후속 11");
    expect(res.status).toBe(429);
    expect((await res.json<{ error: string }>()).error).toBe("turn_limit");
    expect((await detail(id)).turnsUsed).toBe(ASK_TURN_MAX);
    // 삭제된 턴은 세지 않는다
    sql("UPDATE ask_turn SET deleted_at = '2030-01-01T00:00:00.000Z' WHERE seq = 1");
    expect((await turn(id, "합성 후속 11")).status).toBe(201);
  });

  it("레이트리밋: 질문과 후속이 같은 한도(10분 10건)를 나눠 쓰고, 429 가 409 보다 먼저다", async () => {
    const id = await doneQuestion(); // 질문 1건
    for (let i = 0; i < 8; i++) await ask(`합성 질문 ${String(i)}`); // 질문 9건
    expect((await turn(id, "10번째 요청")).status).toBe(201); // 턴 1건 = 10건째
    settleTurns();
    const res = await turn(id, "11번째 요청");
    expect(res.status).toBe(429);
    expect((await res.json<{ error: string }>()).error).toBe("too_many");
    // 질문 쪽도 같은 한도를 본다
    expect((await ask("또 질문")).status).toBe(429);
    // 우선순위: 레이트리밋(429) 이 활성 턴(409) 보다 먼저
    sql("UPDATE ask_turn SET status = 'pending'");
    const first = await turn(id, "또 후속");
    expect(first.status).toBe(429);
    // 다른 사람과 10분 뒤에는 영향 없음
    sql("UPDATE ask_turn SET status = 'done'");
    expect((await turn(id, "다른 사람 후속", "아빠")).status).toBe(201);
    h.clock.t += ASK_RATE.windowMs + 1000;
    settleTurns();
    expect((await turn(id, "10분 뒤 후속")).status).toBe(201);
  });
});

describe("POST /api/ask/:id/turn — 위급 후속", () => {
  it("활성 턴·10번 한도·레이트리밋을 모두 무시하고 red_flag=1·잠금·카드 대기 턴으로 만든다", async () => {
    const id = await doneQuestion();
    // 한도 10번을 모두 쓴 상태 + 진행 중인 일반 후속 + 레이트리밋 포화
    for (let i = 1; i <= ASK_TURN_MAX; i++) {
      h.clock.t += ASK_RATE.windowMs + 1000;
      await turn(id, `합성 후속 ${String(i)}`);
      sql("UPDATE ask_turn SET status = 'done', card_status = 'none' WHERE seq = ?", i);
    }
    h.clock.t += ASK_RATE.windowMs + 1000;
    sql("UPDATE ask_turn SET status = 'claimed', card_status = 'none' WHERE seq = 10");
    // 레이트리밋 포화: 같은 사람의 턴 10건이 모두 10분 창 안에 있다
    sql("UPDATE ask_turn SET created_at = ?", new Date(h.clock.t - 1000).toISOString());
    const limited = await turn(id, "합성 후속 11");
    expect(limited.status).toBe(429);
    expect((await limited.json<{ error: string }>()).error).toBe("too_many");
    const res = await turn(id, "자다가 경련을 했어요", "엄마");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 11, seq: 11, redFlag: true });
    // 창 밖으로 내리면 일반 후속은 활성 턴 때문에 409 이다
    sql("UPDATE ask_turn SET created_at = '2000-01-01T00:00:00.000Z' WHERE red_flag = 0");
    expect((await turn(id, "합성 후속 11")).status).toBe(409);
    const [t] = rows<Record<string, unknown>>(h, "SELECT * FROM ask_turn WHERE seq = 11");
    expect(t).toMatchObject({
      kind: "followup",
      red_flag: 1,
      status: "done",
      reply_json: null,
      card_status: "pending",
      asked_by: "엄마",
    });
    const d = await detail(id);
    expect(d.redLock).toBe(true);
    expect(d.turnsUsed).toBe(ASK_TURN_MAX); // 위급 턴은 한도에 세지 않는다
    expect(d.turns[10]).toMatchObject({ redFlag: true, cardStatus: "pending" });
    // 위급 턴이 진행 중이어도 또 위급 후속은 받는다(일반 후속은 계속 막힌다)
    expect((await turn(id, "숨을 못 쉬어요")).status).toBe(201);
    expect((await turn(id, "합성 일반 후속")).status).toBe(409);
  });

  it("잠금이 켜질 때 일반 턴의 카드 대기를 redlock 으로 정리한다(짧은 답 단계 턴은 그대로)", async () => {
    const id = await doneQuestion();
    expect((await turn(id, "합성 후속")).status).toBe(201);
    sql("UPDATE ask_turn SET status = 'done', card_status = 'pending', card_reason = '합성 이유'");
    expect((await turn(id, "경련이 있었어요")).status).toBe(201);
    const [general, red] = rows<{ card_status: string; card_note: string | null }>(
      h,
      "SELECT card_status, card_note FROM ask_turn ORDER BY seq",
    );
    expect(general).toEqual({ card_status: "none", card_note: "redlock" });
    expect(red).toEqual({ card_status: "pending", card_note: null });
    expect(
      rows<{ red_lock: number; red_flag: number }>(
        h,
        "SELECT red_lock, red_flag FROM ask_question",
      )[0],
    ).toEqual({ red_lock: 1, red_flag: 0 });
  });

  it("질문이 done 이 아닐 때 온 위급 후속은 새 위급 질문이 된다(origin_question_id, 턴은 만들지 않는다)", async () => {
    const pending = (await (await ask("대기 중 질문")).json<{ id: number }>()).id;
    const res = await turn(pending, "갑자기 의식이 없어요", "할머니");
    expect(res.status).toBe(201);
    const j = await res.json<{ newQuestionId: number; redFlag: boolean }>();
    expect(j).toEqual({ newQuestionId: pending + 1, redFlag: true });
    expect(rows(h, "SELECT 1 FROM ask_turn")).toHaveLength(0);
    const [nq] = rows<Record<string, unknown>>(
      h,
      `SELECT * FROM ask_question WHERE id = ${String(j.newQuestionId)}`,
    );
    expect(nq).toMatchObject({
      asked_by: "할머니",
      body: "갑자기 의식이 없어요",
      status: "pending",
      red_flag: 1,
      red_lock: 1,
      origin_question_id: pending,
    });
    expect((await detail(j.newQuestionId)).originQuestionId).toBe(pending);
    expect((await detail(pending)).originQuestionId).toBeNull();
    // 위급 질문은 claim 맨 앞이다
    const claim = await workerCall(h, "POST", "/api/worker/ask/claim");
    expect((await claim.json<{ question: { id: number } }>()).question.id).toBe(j.newQuestionId);
  });

  it("레이트리밋이 가득 찬 사람의 위급 글도 받는다(카운트에는 들어간다)", async () => {
    const id = await doneQuestion();
    for (let i = 0; i < ASK_RATE.max - 1; i++) await ask(`합성 질문 ${String(i)}`);
    expect((await ask("또 질문")).status).toBe(429);
    expect((await turn(id, "경련을 했어요")).status).toBe(201);
    expect((await ask("자다가 경련을 했어요")).status).toBe(201); // 위급 질문 생성도 한도보다 먼저
    expect((await ask("평범한 질문")).status).toBe(429);
  });

  it("POST /api/ask 가 위급 질문에 red_lock=1 을 넣고, 일반 질문은 0", async () => {
    await ask("자다가 경련을 했어요");
    await ask("간식을 먹어요");
    expect(
      rows<{ red_flag: number; red_lock: number }>(
        h,
        "SELECT red_flag, red_lock FROM ask_question ORDER BY id",
      ),
    ).toEqual([
      { red_flag: 1, red_lock: 1 },
      { red_flag: 0, red_lock: 0 },
    ]);
  });

  it("seq UNIQUE 위반이면 묶음 전체를 한 번 다시 실행한다(잠금·정리·턴이 한 번씩만 생긴다)", async () => {
    const id = await doneQuestion();
    expect((await turn(id, "합성 후속")).status).toBe(201);
    sql("UPDATE ask_turn SET status = 'done', card_status = 'pending'");
    // 첫 INSERT 한 번만 UNIQUE 위반 오류를 내는 함정(묶음 안이라 앞 문장의 변경도 함께 되돌려진다)
    let armed = true;
    h.fake.sqlite.function("once_unique", () => {
      const hit = armed;
      armed = false;
      return hit ? 1 : 0;
    });
    h.fake.sqlite.exec(
      `CREATE TRIGGER trap BEFORE INSERT ON ask_turn WHEN once_unique() = 1
       BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: ask_turn.question_id, ask_turn.seq'); END`,
    );
    const res = await turn(id, "경련을 했어요");
    expect(res.status).toBe(201);
    expect(armed).toBe(false); // 함정이 실제로 한 번 터졌다
    expect(rows(h, "SELECT 1 FROM ask_turn WHERE red_flag = 1")).toHaveLength(1);
    expect(rows<{ red_lock: number }>(h, "SELECT red_lock FROM ask_question")[0]?.red_lock).toBe(1);
    expect(
      rows<{ card_status: string; card_note: string | null }>(
        h,
        "SELECT card_status, card_note FROM ask_turn WHERE red_flag = 0",
      )[0],
    ).toEqual({ card_status: "none", card_note: "redlock" });
  });

  it("동시에 들어온 위급 후속 둘은 seq 가 겹치지 않는다", async () => {
    const id = await doneQuestion();
    const [a, b] = await Promise.all([
      turn(id, "경련을 했어요"),
      turn(id, "숨을 못 쉬어요", "아빠"),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(rows<{ seq: number }>(h, "SELECT seq FROM ask_turn ORDER BY seq")).toEqual([
      { seq: 1 },
      { seq: 2 },
    ]);
  });
});

describe("GET /api/ask/:id — 대화 필드", () => {
  it("새 필드와 turns[] 모양(기존 필드는 그대로)", async () => {
    const id = await doneQuestion();
    const empty = await (
      await call("GET", `/api/ask/${String(id)}`)
    ).json<Record<string, unknown>>();
    expect(empty).toMatchObject({
      status: "done",
      redFlag: false,
      workerOnline: true, // 방금 claim 해서 seen 이 2분 안
      threadActive: false,
      redLock: false,
      cardUpdates: { used: 0, max: 3 },
      turnsUsed: 0,
      originQuestionId: null,
      turns: [],
      reask: { count: 0, reason: null, by: null },
    });
    expect(Object.keys(empty)).toEqual(
      expect.arrayContaining(["question", "answer", "feedback", "votes", "history", "reask"]),
    );
    // 짧은 답이 끝난 턴(카드 갱신 완료 표지 포함)과 읽을 수 없는 답
    sql(
      `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, status, reply_json, review_score, card_status, card_note, card_version, created_at, replied_at, updated_at)
       VALUES (?, 1, 'followup', '엄마', '합성 후속', 'done', ?, 9.6, 'none', 'limit', NULL, 'c1', 'r1', 'u1')`,
      id,
      JSON.stringify({
        reply: "합성 답",
        fromRecords: [],
        evidence: [],
        cardUpdate: { needed: true, reason: "합성" },
      }),
    );
    sql(
      `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, status, reply_json, card_status, card_note, card_version, created_at, updated_at)
       VALUES (?, 2, 'reask', '아빠', '', 'done', '{broken', 'done', 'weird', 2, 'c2', 'u2')`,
      id,
    );
    const d = await detail(id);
    expect(d.threadActive).toBe(false);
    expect(d.turns).toHaveLength(2);
    expect(FollowupSchema.safeParse(d.turns[0]?.reply).success).toBe(true);
    expect(d.turns[0]).toMatchObject({
      id: 1,
      seq: 1,
      kind: "followup",
      askedBy: "엄마",
      body: "합성 후속",
      reaskReason: null,
      redFlag: false,
      status: "done",
      reviewScore: 9.6,
      cardStatus: "none",
      cardNote: "limit",
      cardVersion: null,
      createdAt: "c1",
      repliedAt: "r1",
    });
    expect(d.turns[1]).toMatchObject({
      reply: null,
      cardNote: null,
      cardVersion: 2,
      kind: "reask",
    });
  });

  it("threadActive: 대기·진행·카드 대기는 true, 끝남·실패·카드 실패는 false", async () => {
    const id = await doneQuestion();
    await turn(id, "합성 후속");
    for (const [status, card, active] of [
      ["pending", "none", true],
      ["claimed", "none", true],
      ["answering", "none", true],
      ["reviewing", "none", true],
      ["done", "pending", true],
      ["done", "none", false],
      ["done", "done", false],
      ["done", "failed", false],
      ["failed", "none", false],
    ] as const) {
      sql("UPDATE ask_turn SET status = ?, card_status = ?", status, card);
      expect((await detail(id)).threadActive, `${status}/${card}`).toBe(active);
    }
  });

  it("카드 갱신 횟수와 잠금이 상세에 보인다(red_lock 만 켜져도 redLock)", async () => {
    const id = await doneQuestion();
    sql("UPDATE ask_question SET card_updates = 2, red_lock = 1");
    const d = await detail(id);
    expect(d.cardUpdates).toEqual({ used: 2, max: 3 });
    expect(d.redLock).toBe(true);
  });

  it("삭제하면 턴도 지워지고(deleted_at) 상세·턴은 404", async () => {
    const id = await doneQuestion();
    await turn(id, "합성 후속");
    expect((await call("DELETE", `/api/ask/${String(id)}`)).status).toBe(204);
    const [t] = rows<{ deleted_at: string | null }>(h, "SELECT deleted_at FROM ask_turn");
    expect(t?.deleted_at).toBe(new Date(h.clock.t).toISOString());
    expect((await call("GET", `/api/ask/${String(id)}`)).status).toBe(404);
    expect((await call("DELETE", `/api/ask/${String(id)}`)).status).toBe(404);
    expect(rows(h, "SELECT 1 FROM ask_turn WHERE deleted_at IS NULL")).toHaveLength(0);
  });
});

describe("workerOnline — 리스가 살아 있는 작업도 온라인", () => {
  const online = async (id: number): Promise<boolean> => (await detail(id)).workerOnline;
  const overviewOnline = async (): Promise<boolean> =>
    (await (await call("GET", "/api/overview")).json<{ ask: { worker: { online: boolean } } }>())
      .ask.worker.online;

  it("seen 이 낡으면 오프라인, 리스가 살아 있는 질문·턴 짧은 답·카드 작업이 있으면 온라인", async () => {
    const id = await doneQuestion();
    h.clock.t += 10 * 60_000; // seen 이 10분 전
    expect(await online(id)).toBe(false);
    expect(await overviewOnline()).toBe(false);
    const nowIso = (): string => new Date(h.clock.t).toISOString();
    const later = (): string => new Date(h.clock.t + LEASE_MS).toISOString();
    const past = (): string => new Date(h.clock.t - 1000).toISOString();

    // 질문: 리스 살아 있음 / 만료
    const q2 = (await (await ask("둘째 질문")).json<{ id: number }>()).id;
    sql("UPDATE ask_question SET status = 'answering', lease_until = ? WHERE id = ?", later(), q2);
    expect(await online(id)).toBe(true);
    expect(await overviewOnline()).toBe(true);
    sql("UPDATE ask_question SET lease_until = ? WHERE id = ?", past(), q2);
    expect(await online(id)).toBe(false);
    sql("UPDATE ask_question SET status = 'failed' WHERE id = ?", q2);

    // 턴 짧은 답 단계
    await turn(id, "합성 후속");
    sql("UPDATE ask_turn SET status = 'reviewing', lease_until = ?", later());
    expect(await online(id)).toBe(true);
    sql("UPDATE ask_turn SET lease_until = ?", past());
    expect(await online(id)).toBe(false);

    // 턴 카드 단계
    sql(
      "UPDATE ask_turn SET status = 'done', card_status = 'pending', card_lease_until = ?",
      later(),
    );
    expect(await online(id)).toBe(true);
    sql("UPDATE ask_turn SET card_lease_until = ?", past());
    expect(await online(id)).toBe(false);
    sql("UPDATE ask_turn SET card_lease_until = NULL");
    expect(await online(id)).toBe(false);

    // 삭제된 질문의 작업은 세지 않는다
    sql("UPDATE ask_turn SET card_lease_until = ?", later());
    sql("UPDATE ask_question SET deleted_at = ? WHERE id = ?", nowIso(), id);
    sql("UPDATE ask_turn SET deleted_at = ?", nowIso());
    expect(await overviewOnline()).toBe(false);
  });
});

describe("GET /api/overview — 대화 반영", () => {
  interface Ov {
    ask: { pending: number; redUnhandled: number; medianTotalMs7d: number | null };
  }
  const overview = async (): Promise<Ov> => (await call("GET", "/api/overview")).json<Ov>();

  it("pending 에 활성 턴을 더하고, 위급 카드 실패는 redUnhandled 로 센다(삭제된 질문의 것은 뺀다)", async () => {
    const id = await doneQuestion();
    expect((await overview()).ask).toMatchObject({ pending: 0, redUnhandled: 0 });
    await turn(id, "합성 후속");
    expect((await overview()).ask.pending).toBe(1);
    sql("UPDATE ask_turn SET status = 'done', card_status = 'pending'");
    expect((await overview()).ask.pending).toBe(1); // 카드 대기도 활성
    sql("UPDATE ask_turn SET card_status = 'none'");
    expect((await overview()).ask.pending).toBe(0);
    h.clock.t += ASK_RATE.windowMs + 1000;
    await turn(id, "경련을 했어요");
    expect((await overview()).ask).toMatchObject({ pending: 1, redUnhandled: 0 });
    sql("UPDATE ask_turn SET card_status = 'failed' WHERE red_flag = 1");
    expect((await overview()).ask).toMatchObject({ pending: 0, redUnhandled: 1 });
    await call("DELETE", `/api/ask/${String(id)}`);
    expect((await overview()).ask).toMatchObject({ pending: 0, redUnhandled: 0 });
  });

  it("7일 중앙값의 창은 질문 시각 기준: 카드를 갱신해 ask_answer.created_at 이 새로워져도 오래된 질문은 빠진다", async () => {
    const id = await doneQuestion();
    expect((await overview()).ask.medianTotalMs7d).not.toBeNull();
    h.clock.t += 8 * 24 * 3600_000; // 8일 뒤
    // 카드 갱신처럼 ask_answer.created_at 만 지금으로 바뀐 상태
    sql(
      "UPDATE ask_answer SET created_at = ? WHERE question_id = ?",
      new Date(h.clock.t).toISOString(),
      id,
    );
    expect((await overview()).ask.medianTotalMs7d).toBeNull();
  });
});
