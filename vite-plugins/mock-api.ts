import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { MOCK_MODULES, type MockContext } from "./mock/index.ts";

/**
 * FAKE session API for local UI work and e2e only. NOT a real auth implementation.
 * Enabled only with VITE_MOCK_API=1 (`npm run dev:mock`) and only in `vite serve`
 * (apply: "serve"), so it can never be part of a production build.
 *
 * Behaviour (stateless, so parallel e2e workers do not interfere):
 *  - POST /api/session {pin}: "0000" -> 204 + cookie; "1111" -> 429 locked (retryAfterSec 120);
 *    anything else -> 401 invalid_pin.
 *  - GET  /api/session: {authenticated, pinLength: 4} by cookie presence. MOCK_NO_PIN_LENGTH=1 omits pinLength
 *    (the old 4~12 digits + "확인" flow).
 *  - DELETE /api/session: 204, cookie cleared.
 */
const COOKIE = "yj_mock_session";

function sender(res: ServerResponse): MockContext["send"] {
  return (status, body, headers = {}) => {
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (body === undefined) {
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        resolve(undefined);
      }
    });
  });
}

export function mockApi(): Plugin {
  return {
    name: "mock-api",
    apply: "serve",
    configureServer(server) {
      // Feature modules (vite-plugins/mock/*.ts). Like the real middleware, data routes need a session.
      for (const mod of MOCK_MODULES) {
        server.middlewares.use(mod.prefix, (req, res) => {
          const url = new URL(req.url ?? "/", "http://mock");
          const authed = (req.headers.cookie ?? "").includes(`${COOKIE}=1`);
          const send = sender(res);
          if (!authed) {
            send(401, { error: "unauthenticated", message: "unauthenticated" });
            return;
          }
          void mod.handle(req, res, {
            subPath: url.pathname === "/" ? "" : url.pathname,
            query: url.searchParams,
            authed,
            send,
            readJson: () => readJson(req),
          });
        });
      }
      server.middlewares.use("/api/session", (req, res) => {
        const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
          res.statusCode = status;
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
          if (body === undefined) {
            res.end();
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        const authed = (req.headers.cookie ?? "").includes(`${COOKIE}=1`);
        if (req.method === "GET") {
          send(
            200,
            process.env.MOCK_NO_PIN_LENGTH === "1"
              ? { authenticated: authed }
              : { authenticated: authed, pinLength: 4 },
          );
        } else if (req.method === "DELETE") {
          send(204, undefined, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0` });
        } else if (req.method === "POST") {
          let raw = "";
          req.on("data", (c: Buffer) => (raw += c.toString()));
          req.on("end", () => {
            let pin = "";
            try {
              const parsed = JSON.parse(raw) as { pin?: unknown };
              if (typeof parsed.pin === "string") pin = parsed.pin;
            } catch {
              /* treated as wrong PIN */
            }
            if (pin === "0000") {
              send(204, undefined, {
                "Set-Cookie": `${COOKIE}=1; Path=/; HttpOnly; SameSite=Strict`,
              });
            } else if (pin === "1111") {
              send(429, { error: "locked", message: "locked", retryAfterSec: 120 });
            } else {
              send(401, { error: "invalid_pin", message: "invalid pin" });
            }
          });
        } else {
          send(405, { error: "method_not_allowed", message: "method not allowed" });
        }
      });
    },
  };
}
