// /api/worker/* 가드 시험 (docs/04 §3-2): Bearer 만 인증, 세션 쿠키 불가, Bearer 로는 다른 API 불가, 경로 우회 불가.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constantTimeEqual, sha256Hex } from "../auth/worker";
import { workerCall, sessionCall } from "../test-utils/ask";
import {
  ORIGIN,
  TEST_PIN,
  TEST_WORKER_TOKEN,
  cookieFrom,
  createHarness,
  type Harness,
} from "../test-utils/harness";
import { countRows } from "../test-utils/fake-d1";

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

const fails = () =>
  (h.fake.sqlite.prepare("SELECT COUNT(*) AS n FROM worker_auth_fail").get() as { n: number }).n;

describe("worker 영역 인증", () => {
  it("올바른 Bearer 토큰이면 ping 이 204", async () => {
    const res = await workerCall(h, "GET", "/api/worker/ping");
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("ASK_WORKER_TOKEN_HASH 가 없으면 503 (fail closed), 형식이 틀려도 503", async () => {
    delete h.env.ASK_WORKER_TOKEN_HASH;
    const res = await workerCall(h, "GET", "/api/worker/ping");
    expect(res.status).toBe(503);
    expect((await res.json<{ error: string }>()).error).toBe("worker_disabled");
    h.env.ASK_WORKER_TOKEN_HASH = "not-hex";
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(503);
    h.env.ASK_WORKER_TOKEN_HASH = "a".repeat(63);
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(503);
    expect(fails()).toBe(0);
  });

  it("해시가 대문자 hex 여도 맞는다", async () => {
    h.env.ASK_WORKER_TOKEN_HASH = (await sha256Hex(TEST_WORKER_TOKEN)).toUpperCase();
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
  });

  it("토큰이 없거나 틀리면 401, 세션 쿠키만으로는 401", async () => {
    expect((await workerCall(h, "GET", "/api/worker/ping", undefined, null)).status).toBe(401);
    expect(
      (await workerCall(h, "GET", "/api/worker/ping", undefined, "wrong-token-0123456789")).status,
    ).toBe(401);
    const res = await h.handle(
      new Request(`${ORIGIN}/api/worker/ping`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(401);
    // 쿠키 + 틀린 Bearer 도 401
    const both = await h.handle(
      new Request(`${ORIGIN}/api/worker/ask/claim`, {
        method: "POST",
        headers: { Cookie: cookie, Authorization: "Bearer wrong-token-0123456789" },
      }),
    );
    expect(both.status).toBe(401);
  });

  it("Bearer 형식이 아니면(Basic·공백·너무 짧음) 401", async () => {
    for (const authorization of [
      `Basic ${TEST_WORKER_TOKEN}`,
      `bearer ${TEST_WORKER_TOKEN}`,
      `Bearer  ${TEST_WORKER_TOKEN}`,
      `Bearer short`,
      `Bearer ${TEST_WORKER_TOKEN} extra`,
    ]) {
      const res = await h.handle(
        new Request(`${ORIGIN}/api/worker/ping`, { headers: { Authorization: authorization } }),
      );
      expect(res.status, authorization).toBe(401);
    }
  });

  it("Bearer 로는 세션이 필요한 다른 API 에 들어갈 수 없다", async () => {
    for (const path of ["/api/ask", "/api/notes", "/api/overview", "/api/logs"]) {
      const res = await h.handle(
        new Request(ORIGIN + path, { headers: { Authorization: `Bearer ${TEST_WORKER_TOKEN}` } }),
      );
      expect(res.status, path).toBe(401);
    }
    const post = await h.handle(
      new Request(`${ORIGIN}/api/ask`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_WORKER_TOKEN}`,
        },
        body: JSON.stringify({ body: "합성 질문", askedBy: "엄마" }),
      }),
    );
    expect(post.status).toBe(401);
  });

  it("경로 정규화 우회: 퍼센트 인코딩·이중 슬래시·대소문자·끝 슬래시는 통과하지 못한다", async () => {
    const paths = [
      "/%61pi/worker/ping",
      "/api/%77orker/ping",
      "//api/worker/ping",
      "/api//worker/ping",
      "/API/WORKER/ping",
      "/Api/Worker/ping",
      "/api/worker/ping/",
      "/api/worker/./ping/",
      "/api/worker%2fping",
      "/api/worker/%2e%2e%2fworker/ping",
      "/api/worker/ping%00",
    ];
    for (const path of paths) {
      const res = await workerCall(h, "GET", path);
      expect(res.status, path).toBe(404);
      const sess = await h.handle(new Request(ORIGIN + path, { headers: { Cookie: cookie } }));
      expect([401, 404], path).toContain(sess.status);
    }
  });

  it("/api/worker/../ask 는 /api/ask 로 해석되므로 Bearer 로는 401, 세션 쿠키가 있어야 한다", async () => {
    const bearer = await workerCall(h, "GET", "/api/worker/../ask");
    expect(bearer.status).toBe(401);
    const encoded = await workerCall(h, "GET", "/api/worker/%2e%2e/ask");
    expect(encoded.status).toBe(401);
    const slash = await workerCall(h, "GET", "/api/worker%2f..%2fask");
    expect(slash.status).toBe(404);
    const viaCookie = await sessionCall(h, cookie, "GET", "/api/worker/../ask");
    expect(viaCookie.status).toBe(200); // 정식 /api/ask (세션)
  });

  it("퍼센트 인코딩이 깨진 경로는 400", async () => {
    const res = await h.handle(new Request(`${ORIGIN}/api/worker/%E0%A4%A`));
    expect(res.status).toBe(400);
  });

  it("Origin 이 있고 자기 origin 이 아니면 403, 자기 origin 이거나 없으면 통과", async () => {
    const headers = { Authorization: `Bearer ${TEST_WORKER_TOKEN}` };
    const other = await h.handle(
      new Request(`${ORIGIN}/api/worker/ping`, {
        headers: { ...headers, Origin: "https://evil.example" },
      }),
    );
    expect(other.status).toBe(403);
    const nullOrigin = await h.handle(
      new Request(`${ORIGIN}/api/worker/ping`, { headers: { ...headers, Origin: "null" } }),
    );
    expect(nullOrigin.status).toBe(403);
    const own = await h.handle(
      new Request(`${ORIGIN}/api/worker/ping`, { headers: { ...headers, Origin: ORIGIN } }),
    );
    expect(own.status).toBe(204);
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
  });

  it("본문이 있는 요청은 JSON 만(415)", async () => {
    const res = await h.handle(
      new Request(`${ORIGIN}/api/worker/ask/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_WORKER_TOKEN}`, "Content-Type": "text/plain" },
        body: "x",
      }),
    );
    expect(res.status).toBe(415);
  });

  it("라우터가 가드 없이 직접 불려도 토큰이 없으면 401 (이중 확인)", async () => {
    const res = await h.app.fetch(new Request(`${ORIGIN}/api/worker/ping`), h.env);
    expect(res.status).toBe(401);
    const cookieOnly = await h.app.fetch(
      new Request(`${ORIGIN}/api/worker/ask/claim`, {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      h.env,
    );
    expect(cookieOnly.status).toBe(401);
  });
});

describe("worker 실패 제한", () => {
  const wrong = () => workerCall(h, "GET", "/api/worker/ping", undefined, "wrong-token-0123456789");

  it("10분 20회 실패까지는 401, 21번째 실패 뒤 15분은 틀린 토큰만 429 (맞는 토큰은 항상 통과)", async () => {
    for (let i = 0; i < 20; i++) expect((await wrong()).status).toBe(401);
    expect(fails()).toBe(20);
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
    expect((await wrong()).status).toBe(401); // 21번째 실패 -> 잠금 기록
    expect(fails()).toBe(21);
    // 잠금 중: 맞는 토큰은 통과
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
    expect((await workerCall(h, "POST", "/api/worker/ask/claim")).status).toBe(204);
    // 잠금 중: 틀린 토큰은 429 이고 실패 행을 쓰지 않는다
    const locked = await wrong();
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(locked.headers.get("Retry-After"))).toBeLessThanOrEqual(900);
    expect((await locked.json<{ error: string }>()).error).toBe("locked");
    for (let i = 0; i < 5; i++) expect((await wrong()).status).toBe(429);
    expect((await workerCall(h, "GET", "/api/worker/ping", undefined, null)).status).toBe(429);
    expect(fails()).toBe(21);
    h.clock.t += 14 * 60_000;
    expect((await wrong()).status).toBe(429);
    h.clock.t += 61_000;
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
    expect((await wrong()).status).toBe(401); // 잠금이 풀리면 예전처럼 401·기록
  });

  it("PIN 시도 표(auth_attempt)와 섞이지 않는다", async () => {
    for (let i = 0; i < 25; i++) await wrong();
    expect(countRows(h.fake.sqlite, "ok = 0")).toBe(0);
    // 반대로 PIN 실패가 워커 잠금에 영향을 주지 않는다
    for (let i = 0; i < 5; i++) await h.login("0000000", "198.51.100.9");
    h.clock.t += 16 * 60_000;
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
  });

  it("헤더가 아예 없는 요청은 실패로 세지 않는다", async () => {
    for (let i = 0; i < 30; i++) await workerCall(h, "GET", "/api/worker/ping", undefined, null);
    expect(fails()).toBe(0);
    expect((await workerCall(h, "GET", "/api/worker/ping")).status).toBe(204);
  });

  it("오래된 실패 기록은 하루 뒤 정리된다", async () => {
    await wrong();
    h.clock.t += 25 * 60 * 60_000;
    await wrong();
    expect(fails()).toBe(1);
  });

  it("오류 응답과 로그에 토큰·질문 글이 없다", async () => {
    const spy = vi.spyOn(console, "error");
    h.fake.failWith(new Error("D1 exceeded its limit"));
    const res = await workerCall(h, "GET", "/api/worker/ping");
    h.fake.failWith(null);
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json()) + JSON.stringify(spy.mock.calls);
    expect(text).not.toContain(TEST_WORKER_TOKEN);
    expect(text).not.toContain(await sha256Hex(TEST_WORKER_TOKEN));
  });
});

describe("constantTimeEqual", () => {
  it("같으면 true, 다르거나 길이가 다르면 false", () => {
    expect(constantTimeEqual("abcd", "abcd")).toBe(true);
    expect(constantTimeEqual("abcd", "abce")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
