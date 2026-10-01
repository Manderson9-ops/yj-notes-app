import { describe, expect, it } from "vitest";
import { bytesToBase64Url, utf8 } from "./encoding";
import {
  COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  buildClearCookie,
  buildSessionCookie,
  createSessionToken,
  getCookie,
  isAuthenticated,
  readSessionEpoch,
  verifySessionToken,
} from "./session";
import { START_MS, createHarness } from "../test-utils/harness";

const SECRET = "unit-test-secret-0123456789abcdef";

async function sign(payloadPart: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(payloadPart))));
}
const part = (o: unknown) => bytesToBase64Url(utf8(JSON.stringify(o)));
const good = (over: Record<string, unknown> = {}) => ({
  v: 1,
  epoch: 1,
  iat: Math.floor(START_MS / 1000),
  exp: Math.floor(START_MS / 1000) + 1000,
  dev: "abc",
  ...over,
});

describe("session token", () => {
  it("round-trips payload {v,epoch,iat,exp,dev} with a 30 day lifetime", async () => {
    const token = await createSessionToken(SECRET, 3, START_MS);
    const p = await verifySessionToken(token, SECRET, START_MS + 1000);
    expect(p).not.toBeNull();
    expect(p?.v).toBe(1);
    expect(p?.epoch).toBe(3);
    expect(p?.iat).toBe(Math.floor(START_MS / 1000));
    expect(p?.exp).toBe((p?.iat ?? 0) + SESSION_MAX_AGE_SEC);
    expect(SESSION_MAX_AGE_SEC).toBe(2_592_000);
    expect(p?.dev).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 random bytes, base64url
  });

  it("gives each login a distinct device id", async () => {
    const a = await verifySessionToken(
      await createSessionToken(SECRET, 1, START_MS),
      SECRET,
      START_MS,
    );
    const b = await verifySessionToken(
      await createSessionToken(SECRET, 1, START_MS),
      SECRET,
      START_MS,
    );
    expect(a?.dev).not.toBe(b?.dev);
  });

  it("rejects a tampered payload (signature no longer matches)", async () => {
    const token = await createSessionToken(SECRET, 1, START_MS);
    const [, sig] = token.split(".") as [string, string];
    const forged = `${part(good({ epoch: 2 }))}.${sig}`;
    expect(await verifySessionToken(forged, SECRET, START_MS)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const token = await createSessionToken(SECRET, 1, START_MS);
    const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(await verifySessionToken(flipped, SECRET, START_MS)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const payloadPart = part(good());
    const token = `${payloadPart}.${await sign(payloadPart, "other-secret")}`;
    expect(await verifySessionToken(token, SECRET, START_MS)).toBeNull();
  });

  it("rejects expired tokens (exp <= now) and accepts one second before", async () => {
    const payloadPart = part(good({ exp: 2000, iat: 1000 }));
    const token = `${payloadPart}.${await sign(payloadPart)}`;
    expect(await verifySessionToken(token, SECRET, 1_999_000)).not.toBeNull();
    expect(await verifySessionToken(token, SECRET, 2_000_000)).toBeNull();
  });

  it("rejects correctly signed but malformed payloads", async () => {
    const bad = [
      good({ v: 2 }),
      good({ epoch: "1" }),
      good({ epoch: 1.5 }),
      good({ exp: undefined }),
      good({ dev: "" }),
      { ...good(), extra: true },
      "not an object",
      null,
    ];
    for (const payload of bad) {
      const p = part(payload);
      expect(await verifySessionToken(`${p}.${await sign(p)}`, SECRET, START_MS)).toBeNull();
    }
    const notJson = bytesToBase64Url(utf8("{oops"));
    expect(
      await verifySessionToken(`${notJson}.${await sign(notJson)}`, SECRET, START_MS),
    ).toBeNull();
  });

  it("rejects structurally invalid tokens without throwing", async () => {
    for (const t of ["", "abc", "a.b.c", ".", "!!!.???", "abc.", `${part(good())}.short`]) {
      expect(await verifySessionToken(t, SECRET, START_MS)).toBeNull();
    }
  });
});

describe("cookie helpers", () => {
  it("builds the session cookie with all required attributes", () => {
    expect(buildSessionCookie("tok")).toBe(
      "yjs=tok; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000",
    );
  });

  it("builds an expiring cookie for logout", () => {
    expect(buildClearCookie()).toBe("yjs=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  });

  it("parses the yjs cookie among others, exact name only", () => {
    expect(getCookie("a=1; yjs=tok; b=2", COOKIE_NAME)).toBe("tok");
    expect(getCookie("xyjs=bad; yjs=ok", COOKIE_NAME)).toBe("ok");
    expect(getCookie("a=1", COOKIE_NAME)).toBeNull();
    expect(getCookie("novalue; yjs", COOKIE_NAME)).toBeNull();
    expect(getCookie(null, COOKIE_NAME)).toBeNull();
  });
});

describe("epoch", () => {
  it("reads session_epoch from app_setting; null when missing or not a number", async () => {
    const h = await createHarness();
    expect(await readSessionEpoch(h.env.DB)).toBe(1);
    h.fake.sqlite.exec("UPDATE app_setting SET value='x' WHERE key='session_epoch'");
    expect(await readSessionEpoch(h.env.DB)).toBeNull();
    h.fake.sqlite.exec("DELETE FROM app_setting WHERE key='session_epoch'");
    expect(await readSessionEpoch(h.env.DB)).toBeNull();
  });

  it("isAuthenticated: valid + matching epoch only; fail closed when epoch is unreadable", async () => {
    const h = await createHarness();
    const token = await createSessionToken(h.env.SESSION_SECRET, 1, START_MS);
    const req = (cookie?: string) =>
      new Request("https://x.test/api/a", cookie ? { headers: { Cookie: cookie } } : {});
    expect(await isAuthenticated(req(), h.env, START_MS)).toBe(false);
    expect(await isAuthenticated(req("yjs=garbage"), h.env, START_MS)).toBe(false);
    expect(await isAuthenticated(req(`yjs=${token}`), h.env, START_MS)).toBe(true);
    h.fake.sqlite.exec("UPDATE app_setting SET value='2' WHERE key='session_epoch'");
    expect(await isAuthenticated(req(`yjs=${token}`), h.env, START_MS)).toBe(false);
    h.fake.sqlite.exec("DELETE FROM app_setting WHERE key='session_epoch'");
    expect(await isAuthenticated(req(`yjs=${token}`), h.env, START_MS)).toBe(false);
  });
});
