import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { errorResponse, isQuotaError, toErrorResponse } from "./errors";
import {
  AUTH_ALLOWLIST,
  guardMiddleware,
  isAllowlisted,
  normalizePath,
  type Authenticate,
} from "./guard";
import { CSP } from "./headers";

const ORIGIN = "https://app.example.test";
const env = {} as Env;
const NEXT_BODY = "next-called";

function run(
  request: Request,
  options: { authed?: boolean; next?: () => Promise<Response> } = {},
): Promise<Response> {
  const authenticate: Authenticate = () => Promise.resolve(options.authed ?? false);
  return guardMiddleware(
    request,
    env,
    options.next ?? (() => Promise.resolve(new Response(NEXT_BODY))),
    { authenticate, deps: { now: () => 0 } },
  );
}

const jsonPost = (path: string) =>
  new Request(ORIGIN + path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: "{}",
  });

describe("guardMiddleware", () => {
  it("returns 401 auth_required for protected API without a session", async () => {
    const res = await run(new Request(`${ORIGIN}/api/notes`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth_required", message: "로그인이 필요해요." });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("passes authenticated API requests through to next()", async () => {
    const res = await run(new Request(`${ORIGIN}/api/notes`), { authed: true });
    expect(await res.text()).toBe(NEXT_BODY);
  });

  it("allowlist is exactly session + health, and HEAD counts as GET", () => {
    expect(AUTH_ALLOWLIST).toEqual(["POST /api/session", "GET /api/session", "GET /api/health"]);
    expect(isAllowlisted("HEAD", "/api/health")).toBe(true);
    expect(isAllowlisted("DELETE", "/api/session")).toBe(false);
    expect(isAllowlisted("GET", "/api/health/")).toBe(false);
    expect(isAllowlisted("GET", "/API/health")).toBe(false);
  });

  it("allowlisted routes reach next() without calling authenticate", async () => {
    const authenticate = vi.fn<Authenticate>(() => Promise.resolve(false));
    const res = await guardMiddleware(
      new Request(`${ORIGIN}/api/health`),
      env,
      () => Promise.resolve(new Response("ok")),
      { authenticate, deps: { now: () => 0 } },
    );
    expect(await res.text()).toBe("ok");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("treats case, encoding and double-slash variants of /api as API", async () => {
    for (const p of ["/API/notes", "//api/notes", "/%61pi/notes", "/api"]) {
      const res = await run(new Request(ORIGIN + p));
      expect(res.status, p).toBe(401);
    }
  });

  it("rejects undecodable paths with 400 and headers", async () => {
    const res = await run(new Request(`${ORIGIN}/api/%E0%A4%A`));
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(normalizePath("/%zz")).toBeNull();
  });

  it("static paths skip auth but still get headers", async () => {
    const res = await run(new Request(`${ORIGIN}/index.html`));
    expect(await res.text()).toBe(NEXT_BODY);
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  describe("Origin check", () => {
    it("403 bad_origin on mismatch, missing, or null Origin for unsafe methods", async () => {
      for (const origin of ["https://evil.example", "null", undefined]) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (origin) headers.Origin = origin;
        const res = await run(
          new Request(`${ORIGIN}/api/session`, { method: "POST", headers, body: "{}" }),
          { authed: true },
        );
        expect(res.status, String(origin)).toBe(403);
        expect((await res.json<{ error: string }>()).error).toBe("bad_origin");
      }
    });

    it("is checked before auth (cross-site request cannot probe session state)", async () => {
      const res = await run(
        new Request(`${ORIGIN}/api/logs/1`, {
          method: "PUT",
          headers: { Origin: "https://evil.example" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("does not apply to GET/HEAD/OPTIONS", async () => {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        const res = await run(new Request(`${ORIGIN}/api/notes`, { method }), { authed: true });
        expect(res.status, method).toBe(200);
      }
    });

    it("accepts the same origin", async () => {
      const res = await run(jsonPost("/api/session"));
      expect(await res.text()).toBe(NEXT_BODY);
    });
  });

  describe("content-type check", () => {
    it("415 for a body without application/json", async () => {
      for (const ct of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
        const headers: Record<string, string> = { Origin: ORIGIN };
        if (ct) headers["Content-Type"] = ct;
        const res = await run(
          new Request(`${ORIGIN}/api/logs/1`, { method: "PUT", headers, body: "x=1" }),
          { authed: true },
        );
        expect(res.status, String(ct)).toBe(415);
      }
    });

    it("accepts application/json with charset (case-insensitive)", async () => {
      const res = await run(
        new Request(`${ORIGIN}/api/logs/1`, {
          method: "PUT",
          headers: { Origin: ORIGIN, "Content-Type": "Application/JSON; charset=utf-8" },
          body: "{}",
        }),
        { authed: true },
      );
      expect(await res.text()).toBe(NEXT_BODY);
    });

    it("rejects look-alike types", async () => {
      const res = await run(
        new Request(`${ORIGIN}/api/logs/1`, {
          method: "PUT",
          headers: { Origin: ORIGIN, "Content-Type": "application/jsonp" },
          body: "{}",
        }),
        { authed: true },
      );
      expect(res.status).toBe(415);
    });

    it("DELETE without a body needs no content-type", async () => {
      const res = await run(
        new Request(`${ORIGIN}/api/logs/1`, { method: "DELETE", headers: { Origin: ORIGIN } }),
        { authed: true },
      );
      expect(await res.text()).toBe(NEXT_BODY);
    });

    it("an empty body stream (as some proxies send for bodiless DELETE) needs no content-type", async () => {
      const empty = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
      const req = new Request(`${ORIGIN}/api/logs/1`, {
        method: "DELETE",
        headers: { Origin: ORIGIN },
        body: empty,
        duplex: "half",
      } as RequestInit);
      expect(await (await run(req, { authed: true })).text()).toBe(NEXT_BODY);
    });

    it("Content-Length: 0 means no body; a non-empty stream without Content-Length is a body", async () => {
      const noBody = new Request(`${ORIGIN}/api/logs/1`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, "Content-Length": "0" },
      });
      expect(await (await run(noBody, { authed: true })).text()).toBe(NEXT_BODY);

      const chunk = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([123, 125]));
          controller.close();
        },
      });
      const withBody = new Request(`${ORIGIN}/api/logs/1`, {
        method: "PUT",
        headers: { Origin: ORIGIN },
        body: chunk,
        duplex: "half",
      } as RequestInit);
      expect((await run(withBody, { authed: true })).status).toBe(415);
    });

    it("auth failure wins over content-type failure (no probing by unauthenticated callers)", async () => {
      const res = await run(
        new Request(`${ORIGIN}/api/logs/1`, {
          method: "PUT",
          headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
          body: "x",
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("failure handling", () => {
    it("fails closed with a generic 500 if authenticate throws; logs only method+path+status", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const authenticate: Authenticate = () => Promise.reject(new Error("SELECT secret FROM x"));
      const res = await guardMiddleware(
        new Request(`${ORIGIN}/api/notes?q=secretword`, { headers: { Cookie: "yjs=abc" } }),
        env,
        () => Promise.resolve(new Response("should not run")),
        { authenticate, deps: { now: () => 0 } },
      );
      expect(res.status).toBe(500);
      expect(await res.text()).toBe(
        JSON.stringify({ error: "internal", message: "잠시 후 다시 시도해 주세요." }),
      );
      expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
      expect(spy).toHaveBeenCalledWith("GET /api/notes 500");
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("secret");
      expect(logged).not.toContain("yjs");
      spy.mockRestore();
    });

    it("maps D1 quota errors to 503 quota_exceeded", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = await run(new Request(`${ORIGIN}/api/notes`), {
        authed: true,
        next: () => Promise.reject(new Error("D1 DB exceeded its daily read limit")),
      });
      expect(res.status).toBe(503);
      expect((await res.json<{ error: string }>()).error).toBe("quota_exceeded");
      spy.mockRestore();
    });
  });
});

describe("errors", () => {
  it("isQuotaError heuristic", () => {
    expect(isQuotaError(new Error("Exceeded"))).toBe(true);
    expect(isQuotaError(new Error("rate LIMIT"))).toBe(true);
    expect(isQuotaError("limit reached")).toBe(true);
    expect(isQuotaError(new Error("boom"))).toBe(false);
    expect(isQuotaError(42)).toBe(false);
  });

  it("toErrorResponse is generic for non-quota errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = toErrorResponse(new Error("no such table: note_item"), "POST", "/api/x");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("note_item");
    spy.mockRestore();
  });

  it("errorResponse merges extras", async () => {
    const res = errorResponse(429, "locked", "m", { retryAfterSec: 3 }, { "Retry-After": "3" });
    expect(await res.json()).toEqual({ error: "locked", message: "m", retryAfterSec: 3 });
    expect(res.headers.get("Retry-After")).toBe("3");
  });
});
