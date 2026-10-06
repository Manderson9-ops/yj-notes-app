// 통합 테스트 공통 도구: 가짜 D1 + 주입 시계 + Hono 앱 + 실제 미들웨어 조합.
// Shared test harness. TEST_PIN is a synthetic constant, not a real credential.
import { createApp } from "../app";
import { hashPin } from "../auth/pin";
import { isAuthenticated } from "../auth/session";
import { sha256Hex } from "../auth/worker";
import type { Deps } from "../deps";
import type { Env } from "../env";
import { guardMiddleware } from "../http/guard";
import { createFakeD1, type FakeD1 } from "./fake-d1";

export const ORIGIN = "https://app.example.test";
export const TEST_PIN = "135790";
export const TEST_SALT_B64 = "AAECAwQFBgcICQoLDA0ODw==";
/** 합성 워커 토큰(진짜 값 아님). 서버에는 SHA-256 hex 만 둔다. */
export const TEST_WORKER_TOKEN = "test-worker-token-0123456789abcdef";
export const START_MS = Date.parse("2030-01-01T00:00:00.000Z");

export interface Harness {
  fake: FakeD1;
  env: Env;
  app: ReturnType<typeof createApp>;
  deps: Deps;
  clock: { t: number };
  sleeps: number[];
  /** 미들웨어 + 앱 (실제 배포와 같은 조합) */
  handle: (request: Request) => Promise<Response>;
  login: (pin: unknown, ip?: string) => Promise<Response>;
  authedGet: (path: string, cookie: string) => Promise<Response>;
}

export async function createHarness(): Promise<Harness> {
  const fake = createFakeD1();
  const env: Env = {
    DB: fake.db,
    FILES: {} as R2Bucket,
    PIN_HASH: await hashPin(TEST_PIN, TEST_SALT_B64),
    PIN_SALT: TEST_SALT_B64,
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    IP_HASH_SALT: "test-ip-salt-0123456789abcdef",
    ASK_WORKER_TOKEN_HASH: await sha256Hex(TEST_WORKER_TOKEN),
  };
  const clock = { t: START_MS };
  const sleeps: number[] = [];
  const deps: Deps = {
    now: () => clock.t,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
  const app = createApp(deps);
  const handle = (request: Request) =>
    guardMiddleware(request, env, () => Promise.resolve(app.fetch(request, env)), {
      authenticate: isAuthenticated,
      deps,
    });
  const login = (pin: unknown, ip = "203.0.113.7") =>
    handle(
      new Request(`${ORIGIN}/api/session`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          "CF-Connecting-IP": ip,
        },
        body: JSON.stringify({ pin }),
      }),
    );
  const authedGet = (path: string, cookie: string) =>
    handle(new Request(ORIGIN + path, { headers: { Cookie: cookie } }));
  return { fake, env, app, deps, clock, sleeps, handle, login, authedGet };
}

/** Set-Cookie 응답 헤더에서 `yjs=<token>` 부분만 꺼낸다. */
export function cookieFrom(res: Response): string {
  const header = res.headers.get("Set-Cookie");
  if (!header) throw new Error("no Set-Cookie");
  return header.split(";")[0] ?? "";
}
