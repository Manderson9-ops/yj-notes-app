import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPin } from "../auth/pin";
import { CSP } from "../http/headers";
import { countRows } from "../test-utils/fake-d1";
import {
  ORIGIN,
  START_MS,
  TEST_PIN,
  TEST_SALT_B64,
  cookieFrom,
  createHarness,
  type Harness,
} from "../test-utils/harness";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const WRONG = "999999";
const json = async <T>(res: Response): Promise<T> => res.json<T>();
const rows = (where = "1=1") => countRows(h.fake.sqlite, where);

function expectHeaders(res: Response): void {
  expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

describe("POST /api/session", () => {
  it("right PIN -> 204 with a hardened cookie", async () => {
    const res = await h.login(TEST_PIN);
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toMatch(/^yjs=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; /);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=2592000"]) {
      expect(setCookie).toContain(attr);
    }
    expectHeaders(res);
    expect(await res.text()).toBe("");
  });

  it("wrong PIN -> 401 invalid_pin, no cookie", async () => {
    const res = await h.login(WRONG);
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "invalid_pin", message: "PIN 이 맞지 않아요." });
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expectHeaders(res);
  });

  it("malformed PINs get the identical generic 401 and count as failures", async () => {
    const wrong = await (await h.login(WRONG)).text();
    const bads = ["", "12", "1234567890123", "abcdef", "13 5790", "-135790"];
    for (const [i, bad] of bads.entries()) {
      const res = await h.login(bad, `192.0.2.${String(i + 10)}`); // distinct IPs: no lockout here
      expect(res.status, bad).toBe(401);
      expect(await res.text()).toBe(wrong);
    }
    expect(rows("ok=0")).toBe(7);
  });

  it("5 malformed PINs lock the IP just like 5 wrong ones", async () => {
    for (let i = 0; i < 5; i++) expect((await h.login("abc")).status).toBe(401);
    expect((await h.login(TEST_PIN)).status).toBe(429);
  });

  it("rejects non-JSON / wrong-shape bodies with 400 and records no attempt", async () => {
    for (const body of [undefined, "not json", "[]", "{}", JSON.stringify({ pin: 123456 })]) {
      const res = await h.handle(
        new Request(`${ORIGIN}/api/session`, {
          method: "POST",
          headers: { Origin: ORIGIN, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body }),
        }),
      );
      expect(res.status, String(body)).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("bad_request");
    }
    expect(rows()).toBe(0);
  });

  it("403 on Origin mismatch, 415 on non-JSON content-type (even on the allowlisted login)", async () => {
    const evil = await h.handle(
      new Request(`${ORIGIN}/api/session`, {
        method: "POST",
        headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
        body: JSON.stringify({ pin: TEST_PIN }),
      }),
    );
    expect(evil.status).toBe(403);
    expect((await json<{ error: string }>(evil)).error).toBe("bad_origin");
    expectHeaders(evil);

    const form = await h.handle(
      new Request(`${ORIGIN}/api/session`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
        body: JSON.stringify({ pin: TEST_PIN }),
      }),
    );
    expect(form.status).toBe(415);
    expect(rows()).toBe(0);
  });

  describe("uniform timing", () => {
    it("sleeps the full 400ms on success and on failure (injected delay)", async () => {
      await h.login(WRONG);
      await h.login(TEST_PIN);
      expect(h.sleeps).toEqual([400, 400]);
    });

    it("only sleeps the remaining time", async () => {
      let calls = 0;
      h.deps.now = () => START_MS + 150 * calls++;
      await h.login(WRONG);
      expect(h.sleeps).toEqual([250]);
    });

    it("does not sleep if the work already took >= 400ms", async () => {
      let calls = 0;
      h.deps.now = () => START_MS + 500 * calls++;
      await h.login(WRONG);
      expect(h.sleeps).toEqual([]);
    });

    it("lockout responses are not delayed (cheap, no PIN work)", async () => {
      for (let i = 0; i < 5; i++) await h.login(WRONG);
      h.sleeps.length = 0;
      expect((await h.login(TEST_PIN)).status).toBe(429);
      expect(h.sleeps).toEqual([]);
    });
  });

  describe("lockout", () => {
    it("per-IP: 5 failures lock that IP; even the right PIN gets 429 with retryAfterSec", async () => {
      for (let i = 0; i < 5; i++) expect((await h.login(WRONG)).status).toBe(401);
      const locked = await h.login(TEST_PIN);
      expect(locked.status).toBe(429);
      expect(await json(locked)).toEqual({
        error: "locked",
        message: "시도 횟수가 너무 많아요. 잠시 후 다시 시도해 주세요.",
        retryAfterSec: 900,
      });
      expect(locked.headers.get("Retry-After")).toBe("900");
      expectHeaders(locked);
      expect(locked.headers.get("Set-Cookie")).toBeNull();
      // another IP is fine
      expect((await h.login(TEST_PIN, "198.51.100.9")).status).toBe(204);
    });

    it("lock check happens before PIN verification (no cookie even for right PIN)", async () => {
      for (let i = 0; i < 5; i++) await h.login(WRONG);
      const res = await h.login(TEST_PIN);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    });

    it("lock expires with the injected clock; retryAfterSec counts down and is not extended by blocked tries", async () => {
      for (let i = 0; i < 5; i++) await h.login(WRONG);
      h.clock.t += 10 * 60_000;
      const mid = await h.login(WRONG);
      expect(mid.status).toBe(429);
      expect((await json<{ retryAfterSec: number }>(mid)).retryAfterSec).toBe(300);
      h.clock.t += 5 * 60_000;
      expect((await h.login(TEST_PIN)).status).toBe(204);
    });

    it("global: 30 failures from different IPs lock everyone for 60 minutes", async () => {
      for (let i = 0; i < 30; i++) {
        const ip = `192.0.2.${String(Math.floor(i / 5) + 1)}`; // 6 IPs x 5 failures
        expect((await h.login(WRONG, ip)).status).toBe(401);
      }
      const res = await h.login(TEST_PIN, "198.51.100.200");
      expect(res.status).toBe(429);
      expect((await json<{ retryAfterSec: number }>(res)).retryAfterSec).toBe(3600);
      h.clock.t += 3_600_000;
      expect((await h.login(TEST_PIN, "198.51.100.200")).status).toBe(204);
    });

    it("successful logins do not count as failures", async () => {
      for (let i = 0; i < 4; i++) await h.login(WRONG);
      expect((await h.login(TEST_PIN)).status).toBe(204);
      expect(rows("ok=1")).toBe(1);
      expect(rows("ok=0")).toBe(4);
      expect((await h.login(WRONG)).status).toBe(401); // 5th failure
      expect((await h.login(TEST_PIN)).status).toBe(429); // 6th attempt blocked
    });

    it("stores only a salted hash of the IP and falls back to 'unknown' without the header", async () => {
      await h.login(WRONG, "203.0.113.7");
      const res = await h.handle(
        new Request(`${ORIGIN}/api/session`, {
          method: "POST",
          headers: { Origin: ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ pin: WRONG }),
        }),
      );
      expect(res.status).toBe(401);
      const stored = h.fake.sqlite.prepare("SELECT ip_hash FROM auth_attempt").all() as {
        ip_hash: string;
      }[];
      expect(stored).toHaveLength(2);
      for (const r of stored) {
        expect(r.ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(r.ip_hash).not.toContain("203.0.113.7");
      }
      expect(stored[0]?.ip_hash).not.toBe(stored[1]?.ip_hash);
    });
  });

  describe("failure modes", () => {
    it("D1 quota error -> 503 quota_exceeded with headers", async () => {
      h.fake.failWith(new Error("D1 DB exceeded its daily request limit"));
      const res = await h.login(TEST_PIN);
      expect(res.status).toBe(503);
      expect((await json<{ error: string }>(res)).error).toBe("quota_exceeded");
      expectHeaders(res);
    });

    it("other D1 error -> generic 500 that leaks nothing", async () => {
      h.fake.failWith(new Error("SQLITE_ERROR: no such table: auth_attempt"));
      const res = await h.login(TEST_PIN);
      expect(res.status).toBe(500);
      expect(await res.text()).toBe(
        JSON.stringify({ error: "internal", message: "잠시 후 다시 시도해 주세요." }),
      );
    });

    it("misconfigured PIN secrets fail closed with 500", async () => {
      h.env.PIN_SALT = "FAKE_PLACEHOLDER_pin_salt";
      expect((await h.login(TEST_PIN)).status).toBe(500);
    });

    it("server config errors are never counted as failures: 10 tries without PIN secrets, then no lockout", async () => {
      const { PIN_HASH, PIN_SALT } = h.env;
      h.env.PIN_HASH = "";
      for (let i = 0; i < 10; i++) expect((await h.login(WRONG)).status).toBe(500);
      expect(rows()).toBe(0);
      h.env.PIN_HASH = PIN_HASH;
      h.env.PIN_SALT = undefined as unknown as string; // binding absent
      for (let i = 0; i < 10; i++) expect((await h.login(TEST_PIN)).status).toBe(500);
      expect(rows()).toBe(0);
      h.env.PIN_SALT = PIN_SALT;
      expect((await h.login(TEST_PIN)).status).toBe(204);
    });

    it("malformed base64 secrets: attempt is rolled back, so no lockout after fixing them", async () => {
      const { PIN_SALT } = h.env;
      h.env.PIN_SALT = "FAKE_PLACEHOLDER_pin_salt";
      for (let i = 0; i < 10; i++) expect((await h.login(WRONG)).status).toBe(500);
      expect(rows()).toBe(0);
      h.env.PIN_SALT = PIN_SALT;
      expect((await h.login(TEST_PIN)).status).toBe(204);
      expect(rows("ok=0")).toBe(0);
    });

    it("real wrong PINs still count after config errors (5 -> locked, 400ms delay kept)", async () => {
      h.env.PIN_HASH = "";
      await h.login(WRONG);
      h.env.PIN_HASH = await hashPin(TEST_PIN, TEST_SALT_B64);
      h.sleeps.length = 0;
      for (let i = 0; i < 5; i++) expect((await h.login(WRONG)).status).toBe(401);
      expect(h.sleeps).toEqual([400, 400, 400, 400, 400]);
      expect((await h.login(TEST_PIN)).status).toBe(429);
    });

    it("missing session_epoch -> 500 even with the right PIN, and no cookie", async () => {
      h.fake.sqlite.exec("DELETE FROM app_setting WHERE key='session_epoch'");
      const res = await h.login(TEST_PIN);
      expect(res.status).toBe(500);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    });
  });
});

describe("GET/DELETE /api/session", () => {
  it("includes pinLength only for a valid PIN_LENGTH, with or without a session", async () => {
    const get = async (cookie?: string) =>
      json(
        await h.handle(
          new Request(`${ORIGIN}/api/session`, cookie ? { headers: { Cookie: cookie } } : {}),
        ),
      );
    h.env.PIN_LENGTH = "6";
    expect(await get()).toEqual({ authenticated: false, pinLength: 6 });
    const cookie = cookieFrom(await h.login(TEST_PIN));
    expect(await get(cookie)).toEqual({ authenticated: true, pinLength: 6 });
    for (const bad of ["3", "13", "abc", "4.5", " 4", "", "04x", "-5"]) {
      h.env.PIN_LENGTH = bad;
      expect(await get(), bad).toEqual({ authenticated: false });
    }
    delete h.env.PIN_LENGTH;
    expect(await get()).toEqual({ authenticated: false });
  });

  it("GET without cookie -> {authenticated:false}; with a fresh login cookie -> true", async () => {
    const anon = await h.handle(new Request(`${ORIGIN}/api/session`));
    expect(anon.status).toBe(200);
    expect(await json(anon)).toEqual({ authenticated: false });
    expectHeaders(anon);

    const cookie = cookieFrom(await h.login(TEST_PIN));
    const me = await h.authedGet("/api/session", cookie);
    expect(await json(me)).toEqual({ authenticated: true });
  });

  it("tampered payload or signature -> authenticated:false and protected API 401", async () => {
    const cookie = cookieFrom(await h.login(TEST_PIN));
    const token = cookie.slice("yjs=".length);
    const [payload, sig] = token.split(".") as [string, string];
    const flip = (s: string) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
    for (const bad of [`${flip(payload)}.${sig}`, `${payload}.${flip(sig)}`, `${sig}.${payload}`]) {
      const c = `yjs=${bad}`;
      expect(await json(await h.authedGet("/api/session", c))).toEqual({ authenticated: false });
      expect((await h.authedGet("/api/logs", c)).status).toBe(401);
    }
  });

  it("expired cookie (30 days + 1s later) -> not authenticated", async () => {
    const cookie = cookieFrom(await h.login(TEST_PIN));
    h.clock.t += 2_592_000_000 - 1000;
    expect(await json(await h.authedGet("/api/session", cookie))).toEqual({ authenticated: true });
    h.clock.t += 1000;
    expect(await json(await h.authedGet("/api/session", cookie))).toEqual({ authenticated: false });
    expect((await h.authedGet("/api/logs", cookie)).status).toBe(401);
  });

  it("epoch bump invalidates every existing session; new logins use the new epoch", async () => {
    const cookie = cookieFrom(await h.login(TEST_PIN));
    expect((await h.authedGet("/api/__no_such_route__", cookie)).status).toBe(404); // authed: reaches the app (no such route)
    h.fake.sqlite.exec(
      "UPDATE app_setting SET value = CAST(value AS INTEGER)+1 WHERE key='session_epoch'",
    );
    expect(await json(await h.authedGet("/api/session", cookie))).toEqual({ authenticated: false });
    expect((await h.authedGet("/api/logs", cookie)).status).toBe(401);

    h.clock.t += 60_000;
    const fresh = cookieFrom(await h.login(TEST_PIN, "198.51.100.1"));
    expect(await json(await h.authedGet("/api/session", fresh))).toEqual({ authenticated: true });
  });

  it("DELETE requires a session, then clears the cookie with 204", async () => {
    const anon = await h.handle(
      new Request(`${ORIGIN}/api/session`, { method: "DELETE", headers: { Origin: ORIGIN } }),
    );
    expect(anon.status).toBe(401);

    const cookie = cookieFrom(await h.login(TEST_PIN));
    const res = await h.handle(
      new Request(`${ORIGIN}/api/session`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, Cookie: cookie },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toBe(
      "yjs=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    );
  });
});

describe("GET /api/health", () => {
  const insertRun = (id: number, status: string, finished: string | null) =>
    h.fake.sqlite
      .prepare(
        "INSERT INTO ingest_run (id, started_at, finished_at, source_commit, status, counts_json, verify_json) VALUES (?, ?, ?, 'c', ?, '{}', '{}')",
      )
      .run(id, "2030-01-01T00:00:00Z", finished, status);

  it("is public, returns version and null lastIngestAt with no ingest", async () => {
    const res = await h.handle(new Request(`${ORIGIN}/api/health`));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: "dev", lastIngestAt: null });
    expectHeaders(res);
  });

  it("reports APP_VERSION and the latest successful ingest only", async () => {
    h.env.APP_VERSION = "1.2.3";
    insertRun(1, "ok", "2030-01-01T01:00:00Z");
    insertRun(2, "ok", "2030-01-02T01:00:00Z");
    insertRun(3, "failed", "2030-01-03T01:00:00Z");
    insertRun(4, "running", null);
    const res = await h.handle(new Request(`${ORIGIN}/api/health`));
    expect(await json(res)).toEqual({
      ok: true,
      version: "1.2.3",
      lastIngestAt: "2030-01-02T01:00:00Z",
    });
  });

  it("exposes no data beyond ok/version/lastIngestAt", async () => {
    const res = await h.handle(new Request(`${ORIGIN}/api/health`));
    expect(Object.keys(await json<object>(res)).sort()).toEqual(["lastIngestAt", "ok", "version"]);
  });
});

describe("misc", () => {
  it("authenticated unknown API path -> 404 JSON with headers", async () => {
    const cookie = cookieFrom(await h.login(TEST_PIN));
    const res = await h.authedGet("/api/does-not-exist", cookie);
    expect(res.status).toBe(404);
    expect((await json<{ error: string }>(res)).error).toBe("not_found");
    expectHeaders(res);
  });
});
