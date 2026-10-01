// Q-SEC (docs/08 §1): 세션 없이 "모든" API 라우트를 호출하면 허용 목록 외에는 전부 401 이어야 한다.
// 라우트 목록은 Hono 앱(app.routes)에서 자동 수집한다 — 하드코딩된 목록은 허용 목록(AUTH_ALLOWLIST)뿐이다.
// 새 라우트를 추가하면 이 테스트가 자동으로 그 라우트를 검사한다(허용 목록을 고치지 않는 한 401 이어야 통과).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { isAuthenticated } from "../../server/auth/session";
import { AUTH_ALLOWLIST, guardMiddleware, type Authenticate } from "../../server/http/guard";
import { CSP, STATIC_SECURITY_HEADERS } from "../../server/http/headers";
import { ORIGIN, createHarness, type Harness } from "../../server/test-utils/harness";

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const STATIC_PATHS = ["/", "/index.html", "/assets/app.js", "/some/spa/route", "/robots.txt"];

interface Probe {
  method: string;
  path: string;
}
type App = ReturnType<typeof createApp>;

/** `/logs/:id`, `/files/*` 같은 패턴을 호출 가능한 경로로 바꾼다. */
function concretize(pattern: string): string {
  return pattern.replace(/:[A-Za-z0-9_]+(\{[^}]*\})?\??/g, "x").replace(/\*/g, "x");
}

/** 앱에 등록된 모든 (method, path). 'ALL' 은 모든 메서드로 펼친다. */
function enumerateRoutes(app: App): Probe[] {
  const seen = new Set<string>();
  const out: Probe[] = [];
  for (const r of app.routes) {
    const path = concretize(r.path);
    const methods: readonly string[] = r.method === "ALL" ? ALL_METHODS : [r.method];
    for (const method of methods) {
      const k = `${method} ${path}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ method, path });
    }
  }
  return out;
}

/** 배포와 같은 조합(미들웨어 + 앱)을 임의의 앱·인증 함수로 만든다. */
function pipeline(h: Harness, app: App, authenticate: Authenticate) {
  return (req: Request): Promise<Response> =>
    guardMiddleware(req, h.env, () => Promise.resolve(app.fetch(req, h.env)), {
      authenticate,
      deps: h.deps,
    });
}

function staticPass(h: Harness, status = 200) {
  return (req: Request): Promise<Response> =>
    guardMiddleware(req, h.env, () => Promise.resolve(new Response("static", { status })), {
      authenticate: () => Promise.resolve(false),
      deps: h.deps,
    });
}

/** 유효한 Origin·JSON 으로 쿠키 없이 호출한다(인증 외 사유로 막히지 않게). */
function anonymousRequest({ method, path }: Probe): Request {
  if (method === "GET") return new Request(ORIGIN + path);
  return new Request(ORIGIN + path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: "{}",
  });
}

const key = (p: Probe): string => `${p.method} ${p.path}`;
const isAllowlisted = (p: Probe): boolean => AUTH_ALLOWLIST.includes(key(p));
const isAuthRequired = async (res: Response): Promise<boolean> =>
  res.status === 401 && (await res.clone().text()).includes("auth_required");

function expectSecurityHeaders(res: Response, label: string): void {
  expect(res.headers.get("Content-Security-Policy"), label).toBe(CSP);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    expect(res.headers.get(name), `${label} ${name}`).toBe(value);
  }
}

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Q-SEC route guard", () => {
  it("collects routes from the Hono app (sanity: the allowlisted routes are registered)", () => {
    const keys = enumerateRoutes(h.app).map(key);
    for (const allowed of AUTH_ALLOWLIST) expect(keys).toContain(allowed);
  });

  it("every registered /api route is 401 auth_required without a cookie, except the allowlist", async () => {
    const probes = enumerateRoutes(h.app).filter((p) => p.path.startsWith("/api/"));
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      const res = await h.handle(anonymousRequest(probe));
      if (isAllowlisted(probe)) {
        expect(await isAuthRequired(res), key(probe)).toBe(false);
      } else {
        expect(res.status, key(probe)).toBe(401);
        expect(await res.json(), key(probe)).toEqual({
          error: "auth_required",
          message: "로그인이 필요해요.",
        });
      }
    }
  });

  it("unregistered /api paths are 401 too for every method (no 404 oracle for anonymous callers)", async () => {
    for (const method of ALL_METHODS) {
      const res = await h.handle(anonymousRequest({ method, path: "/api/__not_registered__/x" }));
      expect(res.status, method).toBe(401);
    }
  });

  it("routes added later are covered automatically and return no data without a session", async () => {
    const app = createApp(h.deps);
    app.get("/api/future/:id", (c) => c.json({ leaked: true }));
    app.post("/api/future", (c) => c.json({ leaked: true }));
    app.all("/api/future-all/*", (c) => c.json({ leaked: true }));
    const probes = enumerateRoutes(app).filter((p) => p.path.startsWith("/api/future"));
    expect(probes.map(key)).toEqual(
      expect.arrayContaining(["GET /api/future/x", "POST /api/future", "DELETE /api/future-all/x"]),
    );
    const run = pipeline(h, app, isAuthenticated);
    for (const probe of probes) {
      const res = await run(anonymousRequest(probe));
      expect(res.status, key(probe)).toBe(401);
      expect(await res.text(), key(probe)).not.toContain("leaked");
    }
  });

  it("the allowlist is exactly the three documented entries", () => {
    expect([...AUTH_ALLOWLIST].sort()).toEqual(
      ["GET /api/health", "GET /api/session", "POST /api/session"].sort(),
    );
  });

  it("lookalike paths do not slip through the allowlist", async () => {
    for (const path of [
      "/api/health/",
      "/api/health/x",
      "/api/session/x",
      "/API/session",
      "/api/Health",
      "/api/session%2Fx",
    ]) {
      const res = await h.handle(new Request(ORIGIN + path));
      expect(res.status, path).toBe(401);
    }
  });

  describe("security headers on every kind of response", () => {
    it("401 (API, unauthenticated)", async () => {
      const res = await h.handle(new Request(`${ORIGIN}/api/notes`));
      expect(res.status).toBe(401);
      expectSecurityHeaders(res, "401");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("200 (API health, and static assets passed through)", async () => {
      const health = await h.handle(new Request(`${ORIGIN}/api/health`));
      expect(health.status).toBe(200);
      expectSecurityHeaders(health, "health");
      expect(health.headers.get("Cache-Control")).toBe("private, no-store");

      for (const path of STATIC_PATHS) {
        const res = await staticPass(h)(new Request(ORIGIN + path));
        expect(res.status, path).toBe(200);
        expectSecurityHeaders(res, path);
      }
    });

    it("404 (static miss and authenticated unknown API route)", async () => {
      const miss = await staticPass(h, 404)(new Request(`${ORIGIN}/nope`));
      expect(miss.status).toBe(404);
      expectSecurityHeaders(miss, "static 404");

      const apiMiss = await pipeline(h, h.app, () => Promise.resolve(true))(
        new Request(`${ORIGIN}/api/nope`),
      );
      expect(apiMiss.status).toBe(404);
      expectSecurityHeaders(apiMiss, "api 404");
    });

    it("500 (handler throws) and 503 (quota), without leaking the error", async () => {
      const app = createApp(h.deps);
      app.get("/api/boom", () => {
        throw new Error("kaboom SELECT leaked");
      });
      app.get("/api/quota", () => {
        throw new Error("D1 exceeded limit");
      });
      const run = pipeline(h, app, () => Promise.resolve(true));
      const boom = await run(new Request(`${ORIGIN}/api/boom`));
      expect(boom.status).toBe(500);
      expect(await boom.clone().text()).not.toContain("leaked");
      expectSecurityHeaders(boom, "500");
      const quota = await run(new Request(`${ORIGIN}/api/quota`));
      expect(quota.status).toBe(503);
      expectSecurityHeaders(quota, "503");
    });

    it("403 (bad origin) and 415 (bad content-type)", async () => {
      const bad = await h.handle(
        new Request(`${ORIGIN}/api/session`, {
          method: "POST",
          headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect(bad.status).toBe(403);
      expectSecurityHeaders(bad, "403");
      const ct = await h.handle(
        new Request(`${ORIGIN}/api/session`, {
          method: "POST",
          headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
          body: "x",
        }),
      );
      expect(ct.status).toBe(415);
      expectSecurityHeaders(ct, "415");
    });
  });
});
