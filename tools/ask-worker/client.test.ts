import { describe, expect, it } from "vitest";
import { ApiError, createClient, NetworkError } from "./client.ts";
import { goodAnswer } from "./fixtures.ts";

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
