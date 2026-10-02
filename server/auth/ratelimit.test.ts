import { describe, expect, it } from "vitest";
import { countRows, createFakeD1 } from "../test-utils/fake-d1";
import { START_MS } from "../test-utils/harness";
import {
  GLOBAL_LIMIT,
  IP_LIMIT,
  RETENTION_MS,
  beginAttempt,
  hashIp,
  markSuccess,
  voidAttempt,
} from "./ratelimit";

describe("hashIp", () => {
  it("is a deterministic salted HMAC (base64url), never the raw IP", async () => {
    const a = await hashIp("203.0.113.7", "salt-a");
    expect(a).toBe(await hashIp("203.0.113.7", "salt-a"));
    expect(a).not.toBe(await hashIp("203.0.113.7", "salt-b"));
    expect(a).not.toBe(await hashIp("203.0.113.8", "salt-a"));
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain("203");
  });
});

describe("beginAttempt", () => {
  it("allows 5 failures per IP, blocks the 6th with retryAfter = last failure + 15min", async () => {
    const { db, sqlite } = createFakeD1();
    for (let i = 0; i < IP_LIMIT.maxFailures; i++) {
      const r = await beginAttempt(db, "ip1", START_MS + i * 1000);
      expect(r.allowed).toBe(true);
    }
    const blocked = await beginAttempt(db, "ip1", START_MS + 10_000);
    expect(blocked).toEqual({
      allowed: false,
      // last failure at +4s, lock until +4s+15min, now = +10s
      retryAfterSec: 15 * 60 - 6,
    });
    // a blocked attempt is not recorded (does not extend the lock)
    expect(countRows(sqlite)).toBe(5);
  });

  it("uses a window boundary of strictly newer than 15 minutes", async () => {
    const { db } = createFakeD1();
    for (let i = 0; i < 5; i++) await beginAttempt(db, "ip1", START_MS);
    expect((await beginAttempt(db, "ip1", START_MS + IP_LIMIT.windowMs - 1)).allowed).toBe(false);
    expect((await beginAttempt(db, "ip1", START_MS + IP_LIMIT.windowMs)).allowed).toBe(true);
  });

  it("other IPs are unaffected by one IP's lock", async () => {
    const { db } = createFakeD1();
    for (let i = 0; i < 5; i++) await beginAttempt(db, "ip1", START_MS);
    expect((await beginAttempt(db, "ip1", START_MS)).allowed).toBe(false);
    expect((await beginAttempt(db, "ip2", START_MS)).allowed).toBe(true);
  });

  it("global lock after 30 failures from different IPs, for 60 minutes from the last failure", async () => {
    const { db } = createFakeD1();
    for (let i = 0; i < GLOBAL_LIMIT.maxFailures; i++) {
      // 6 per ip would trip the per-IP rule, so use 5 per IP across 6 IPs
      const r = await beginAttempt(db, `ip${String(i % 6)}`, START_MS + i * 1000);
      expect(r.allowed).toBe(true);
    }
    const now = START_MS + 40_000;
    const fresh = await beginAttempt(db, "brand-new-ip", now);
    // last failure at +29s; lock until +29s+60min
    expect(fresh).toEqual({ allowed: false, retryAfterSec: 3600 - 11 });
    expect((await beginAttempt(db, "brand-new-ip", START_MS + 29_000 + 3_600_000)).allowed).toBe(
      true,
    );
  });

  it("retryAfter counts down from the last failure, not from the blocked attempt", async () => {
    const { db } = createFakeD1();
    for (let i = 0; i < 5; i++) await beginAttempt(db, "ip1", START_MS);
    const r = await beginAttempt(db, "ip1", START_MS + 60_000);
    expect(r).toEqual({ allowed: false, retryAfterSec: 15 * 60 - 60 });
  });

  it("is atomic: 25 concurrent attempts from one IP yield exactly 5 allowed", async () => {
    const { db, sqlite } = createFakeD1();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => beginAttempt(db, "ip1", START_MS)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(countRows(sqlite)).toBe(5);
  });

  it("deletes rows older than 30 days on each call, keeps newer ones", async () => {
    const { db, sqlite } = createFakeD1();
    const ins = sqlite.prepare("INSERT INTO auth_attempt (ip_hash, at, ok) VALUES (?, ?, 0)");
    ins.run("old", new Date(START_MS - RETENTION_MS - 1000).toISOString());
    ins.run("recent", new Date(START_MS - RETENTION_MS + 1000).toISOString());
    await beginAttempt(db, "ip1", START_MS);
    expect(countRows(sqlite, "ip_hash='old'")).toBe(0);
    expect(countRows(sqlite, "ip_hash='recent'")).toBe(1);
  });
});

describe("markSuccess", () => {
  it("flips the attempt to ok=1 so it stops counting as a failure; other rows untouched", async () => {
    const { db, sqlite } = createFakeD1();
    const a = await beginAttempt(db, "ip1", START_MS);
    const b = await beginAttempt(db, "ip1", START_MS);
    if (!a.allowed || !b.allowed) throw new Error("expected allowed");
    await markSuccess(db, a.attemptId);
    expect(countRows(sqlite, "ok=1")).toBe(1);
    expect(countRows(sqlite, "ok=0")).toBe(1);
    expect(a.attemptId).not.toBe(b.attemptId);
  });
});

describe("voidAttempt", () => {
  it("removes only the given failed attempt (a success row stays)", async () => {
    const { db, sqlite } = createFakeD1();
    const a = await beginAttempt(db, "ip1", START_MS);
    const b = await beginAttempt(db, "ip1", START_MS + 1);
    if (!a.allowed || !b.allowed) throw new Error("expected allowed");
    await markSuccess(db, b.attemptId);
    await voidAttempt(db, b.attemptId);
    expect(countRows(sqlite)).toBe(2);
    await voidAttempt(db, a.attemptId);
    expect(countRows(sqlite)).toBe(1);
  });
});
