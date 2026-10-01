import type { Plugin } from "vite";

/**
 * FAKE session API for local UI work and e2e only. NOT a real auth implementation.
 * Enabled only with VITE_MOCK_API=1 (`npm run dev:mock`) and only in `vite serve`
 * (apply: "serve"), so it can never be part of a production build.
 *
 * Behaviour (stateless, so parallel e2e workers do not interfere):
 *  - POST /api/session {pin}: "0000" -> 204 + cookie; "1111" -> 429 locked (retryAfterSec 120);
 *    anything else -> 401 invalid_pin.
 *  - GET  /api/session: {authenticated} by cookie presence.
 *  - DELETE /api/session: 204, cookie cleared.
 */
const COOKIE = "yj_mock_session";

export function mockApi(): Plugin {
  return {
    name: "mock-api",
    apply: "serve",
    configureServer(server) {
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
          send(200, { authenticated: authed });
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
