import { describe, expect, it } from "vitest";
import {
  ApiError,
  createClient,
  isTurnClaim,
  NetworkError,
  type ClaimedQuestion,
} from "./client.ts";
import { claimTurn, goodAnswer, goodFollowup } from "./fixtures.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: (Response | Error)[]): { fn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const opts = { origin: "https://app.example.test/", token: "t".repeat(24) };

describe("client", () => {
  it("claim: Bearer + Origin 헤더, 204 는 null", async () => {
    const f = fakeFetch([new Response(null, { status: 204 })]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    expect(await c.claim()).toBeNull();
    const call = f.calls[0];
    expect(call?.url).toBe("https://app.example.test/api/worker/ask/claim");
    const h = call?.init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${opts.token}`);
    expect(h.Origin).toBe("https://app.example.test");
    expect(call?.init.method).toBe("POST");
  });

  it("claim: 질문을 파싱하고 redFlag 를 불리언으로 바꾼다", async () => {
    const body = {
      question: {
        id: 7,
        body: "합성 질문",
        askedBy: "테스트",
        createdAt: "2020-03-01T00:00:00Z",
        redFlag: 1,
      },
    };
    const f = fakeFetch([new Response(JSON.stringify(body), { status: 200 })]);
    const q = await createClient({ ...opts, fetchFn: f.fn }).claim();
    expect(q).toMatchObject({ id: 7, redFlag: true });
  });

  it("claim: 모양이 틀린 응답은 ApiError(502)", async () => {
    const f = fakeFetch([new Response(JSON.stringify({ nope: 1 }), { status: 200 })]);
    await expect(createClient({ ...opts, fetchFn: f.fn }).claim()).rejects.toMatchObject({
      status: 502,
    });
  });

  it("progress / answer / fail 경로와 본문", async () => {
    const f = fakeFetch([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    await c.progress(5, "reviewing");
    await c.answer(5, {
      level: 4,
      answer: goodAnswer(),
      reviewScore: 9.6,
      model: "opus",
      workMs: 1234,
    });
    await c.fail(5, "claude_exit");
    expect(f.calls.map((x) => x.url.replace(opts.origin.slice(0, -1), ""))).toEqual([
      "/api/worker/ask/5/progress",
      "/api/worker/ask/5/answer",
      "/api/worker/ask/5/fail",
    ]);
    expect(JSON.parse(f.calls[0]?.init.body as string)).toEqual({ status: "reviewing" });
    expect(JSON.parse(f.calls[1]?.init.body as string)).toMatchObject({
      level: 4,
      reviewScore: 9.6,
      workMs: 1234,
    });
    expect(JSON.parse(f.calls[2]?.init.body as string)).toEqual({ code: "claude_exit" });
  });

  it("HTTP 오류는 ApiError, 연결 실패는 NetworkError (본문 노출 없음)", async () => {
    const f = fakeFetch([new Response("secret body", { status: 401 }), new Error("ECONNRESET")]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    const e = await c.ping().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(401);
    expect((e as ApiError).message).not.toContain("secret");
    await expect(c.ping()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("client: 다시 답변·history (T-Q3)", () => {
  const claimBody = {
    question: {
      id: 7,
      body: "합성 질문",
      askedBy: "테스트",
      createdAt: "2020-03-01T00:00:00Z",
      redFlag: false,
    },
    reask: { count: 1, reason: "이미 해 봤어요", by: "아빠", previousAnswer: goodAnswer() },
  };
  it("claim: reask 덩어리를 질문에 붙여 돌려준다(없으면 키 없음)", async () => {
    const f = fakeFetch([
      new Response(JSON.stringify(claimBody), { status: 200 }),
      new Response(JSON.stringify({ question: claimBody.question }), { status: 200 }),
    ]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    const q = (await c.claim()) as ClaimedQuestion | null;
    expect(q?.reask).toMatchObject({ count: 1, reason: "이미 해 봤어요", by: "아빠" });
    expect(q?.reask?.previousAnswer?.level).toBe(4);
    expect(((await c.claim()) as ClaimedQuestion | null)?.reask).toBeUndefined();
  });
  it("claim: reask 모양이 틀리면 502", async () => {
    const bad = { ...claimBody, reask: { count: 0, reason: "x", by: "a", previousAnswer: null } };
    const c = createClient({ ...opts, fetchFn: fakeFetch([new Response(JSON.stringify(bad))]).fn });
    await expect(c.claim()).rejects.toMatchObject({ status: 502 });
  });
  it("history: GET, limit 은 1~100 으로 맞추고 항목을 파싱한다", async () => {
    const item = {
      id: 3,
      body: "합성",
      askedBy: "엄마",
      createdAt: "2020-03-01T00:00:00Z",
      level: 4,
      tryNowActions: ["a"],
      votes: [],
      notes: [],
    };
    const f = fakeFetch([
      new Response(JSON.stringify({ items: [item] })),
      new Response(JSON.stringify({ items: [] })),
    ]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    expect(await c.history(60)).toEqual([item]);
    expect(f.calls[0]?.url).toBe("https://app.example.test/api/worker/ask/history?limit=60");
    expect(f.calls[0]?.init.method).toBe("GET");
    await c.history(5000);
    expect(f.calls[1]?.url).toContain("limit=100");
  });
  it("history: 401 은 ApiError, 모양 오류·너무 큰 응답은 502", async () => {
    const mk = (r: Response) => createClient({ ...opts, fetchFn: fakeFetch([r]).fn });
    await expect(mk(new Response("", { status: 401 })).history()).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      mk(new Response(JSON.stringify({ items: [{ id: 1 }] }))).history(),
    ).rejects.toMatchObject({ status: 502 });
    await expect(mk(new Response("x".repeat(400_001))).history()).rejects.toMatchObject({
      status: 502,
    });
    await expect(mk(new Response("not json")).history()).rejects.toMatchObject({ status: 502 });
  });
});

describe("client: 턴 claim·턴 경로 (T-Q5)", () => {
  const url = (f: { calls: Call[] }, n: number) =>
    f.calls[n]?.url.replace(opts.origin.slice(0, -1), "");
  const body = (f: { calls: Call[] }, n: number): unknown =>
    JSON.parse(f.calls[n]?.init.body as string);
  const question = {
    id: 7,
    body: "합성 질문",
    askedBy: "테스트",
    createdAt: "2020-03-01T00:00:00Z",
    redFlag: false,
  };
  const turnClaim = claimTurn();

  it("claim: type 이 없는 옛 서버 응답은 질문으로 본다(type:question 도 같다)", async () => {
    const f = fakeFetch([
      new Response(JSON.stringify({ question })),
      new Response(JSON.stringify({ type: "question", question })),
    ]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    for (let i = 0; i < 2; i++) {
      const q = await c.claim();
      expect(q).toMatchObject({ id: 7, body: "합성 질문" });
      expect(q && isTurnClaim(q)).toBe(false);
    }
  });

  it("claim: type:turn 은 턴 claim 으로 파싱한다(thread·단계·한도)", async () => {
    const f = fakeFetch([new Response(JSON.stringify(turnClaim))]);
    const t = await createClient({ ...opts, fetchFn: f.fn }).claim();
    expect(t && isTurnClaim(t)).toBe(true);
    if (!t || !isTurnClaim(t)) throw new Error("턴이어야 해요");
    expect(t).toMatchObject({ stage: "reply", cardUpdatesLeft: 3, redLock: false });
    expect(t.turn).toMatchObject({ id: 11, kind: "followup", askedBy: "아빠" });
    expect(t.thread.question.id).toBe(3);
    expect(t.thread.card?.level).toBe(4);
  });

  it("claim: 턴 모양이 틀리거나 모르는 type 이면 ApiError(502)", async () => {
    const bad = (j: unknown) =>
      createClient({ ...opts, fetchFn: fakeFetch([new Response(JSON.stringify(j))]).fn }).claim();
    await expect(bad({ ...turnClaim, stage: "draft" })).rejects.toMatchObject({ status: 502 });
    await expect(bad({ ...turnClaim, thread: undefined })).rejects.toMatchObject({ status: 502 });
    await expect(bad({ type: "turn" })).rejects.toMatchObject({ status: 502 });
    await expect(bad({ type: "mystery", question })).rejects.toMatchObject({ status: 502 });
  });

  it("turnProgress / turnReply / turnCard / turnFail 경로와 본문", async () => {
    const f = fakeFetch([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ status: "done", cardStatus: "pending" })),
      new Response(JSON.stringify({ status: "done", cardVersion: 2 })),
      new Response(JSON.stringify({ status: "pending", cardStatus: "none" })),
    ]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    await c.turnProgress(9, { stage: "reply", status: "reviewing" });
    await c.turnProgress(9, { stage: "card" });
    const rep = {
      reply: goodFollowup(),
      reviewScore: 9.7,
      model: "opus",
      workMs: 1234,
      cardWanted: true,
      cardSkip: null,
      cardReason: "새 기록",
    };
    expect(await c.turnReply(9, rep)).toEqual({ cardStatus: "pending" });
    await c.turnCard(9, {
      level: 4,
      answer: goodAnswer(),
      reviewScore: 9.6,
      model: "opus",
      workMs: 99,
    });
    await c.turnFail(9, "card", "low_score");
    expect([0, 1, 2, 3, 4].map((n) => url(f, n))).toEqual([
      "/api/worker/ask/turn/9/progress",
      "/api/worker/ask/turn/9/progress",
      "/api/worker/ask/turn/9/reply",
      "/api/worker/ask/turn/9/card",
      "/api/worker/ask/turn/9/fail",
    ]);
    expect(body(f, 0)).toEqual({ stage: "reply", status: "reviewing" });
    expect(body(f, 1)).toEqual({ stage: "card" });
    expect(body(f, 2)).toMatchObject({ reviewScore: 9.7, cardWanted: true, cardSkip: null });
    expect(body(f, 3)).toMatchObject({ level: 4, workMs: 99 });
    expect(body(f, 4)).toEqual({ stage: "card", code: "low_score" });
    for (const x of f.calls) expect(x.init.method).toBe("POST");
  });

  it("turnReply: 응답 본문을 읽지 못해도 확정은 성공(cardStatus null)", async () => {
    const f = fakeFetch([
      new Response("not json"),
      new Response(JSON.stringify({ cardStatus: "x" })),
    ]);
    const c = createClient({ ...opts, fetchFn: f.fn });
    const rep = {
      reply: goodFollowup(),
      reviewScore: 9.7,
      model: "opus",
      workMs: 1,
      cardWanted: false,
      cardSkip: null,
      cardReason: "",
    };
    expect(await c.turnReply(1, rep)).toEqual({ cardStatus: null });
    expect(await c.turnReply(1, rep)).toEqual({ cardStatus: null });
  });

  it("ApiError 는 응답 본문의 code(없으면 error)만 싣고 본문 내용은 싣지 않는다", async () => {
    const mk = (r: Response) => createClient({ ...opts, fetchFn: fakeFetch([r]).fn }).ping();
    const err = async (r: Response) => (await mk(r).catch((e: unknown) => e)) as ApiError;
    const withCode = await err(
      new Response(
        JSON.stringify({ error: "validation_error", code: "redflag_level", message: "비밀 본문" }),
        { status: 422 },
      ),
    );
    expect(withCode.code).toBe("redflag_level");
    expect(withCode.message).toBe("api_422");
    expect(JSON.stringify(withCode)).not.toContain("비밀");
    expect(
      (await err(new Response(JSON.stringify({ error: "card_limit" }), { status: 429 }))).code,
    ).toBe("card_limit");
    // JSON 이 아니거나 코드 모양이 아니면(공백·대문자·너무 긴 값) 코드 없음
    expect((await err(new Response("secret body", { status: 401 }))).code).toBeUndefined();
    expect(
      (await err(new Response(JSON.stringify({ error: "카드 한도" }), { status: 429 }))).code,
    ).toBeUndefined();
    expect(
      (await err(new Response(JSON.stringify({ code: "x".repeat(41) }), { status: 422 }))).code,
    ).toBeUndefined();
    expect((await err(new Response(JSON.stringify([1]), { status: 500 }))).code).toBeUndefined();
    expect(
      (await err(new Response(JSON.stringify({ code: 5, error: "conflict" }), { status: 409 })))
        .code,
    ).toBe("conflict");
  });
});
