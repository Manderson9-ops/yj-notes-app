// 집 PC 워커 인증 (docs/04 §3-2 워커 토큰). 오직 Bearer 토큰만 쓴다 — 세션 쿠키로는 /api/worker/* 에 들어올 수 없고,
// Bearer 로는 다른 /api/* 에 들어올 수 없다(가드가 경로 영역으로 나눈다).
// - 서버에는 토큰의 SHA-256 hex(env.ASK_WORKER_TOKEN_HASH)만 둔다. 비교는 상수 시간.
// - ASK_WORKER_TOKEN_HASH 가 없거나 64자 hex 가 아니면 503 (fail closed).
// - 실패한 시도는 auth_attempt(PIN)와 별도 표(worker_auth_fail)로 센다: 10분 20회 초과 -> 15분 429.
// 토큰·헤더 값은 기록하지 않는다.
import type { Env } from "../env";
import { utf8 } from "./encoding";

export const WORKER_FAIL_LIMIT = { maxFailures: 20, windowMs: 10 * 60_000 } as const;
export const WORKER_LOCK_MS = 15 * 60_000;
const LOCK_KEY = "ask_worker_locked_until";
const RETENTION_MS = 24 * 60 * 60_000;

const HEX64 = /^[0-9a-f]{64}$/i;
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{16,256})$/;
/** 정규화된 경로가 워커 영역인가(대소문자 무시: 라우터·가드의 해석 차이를 쓰지 못하게 영역을 넓게 잡는다). */
const WORKER_REALM = /^\/api\/worker(\/|$)/i;
/** 원본(디코딩 전) 경로의 정식 형태. 이 형태가 아니면 영역 안이라도 404 로 거절한다. */
const CANONICAL_WORKER_PATH = /^\/api\/worker(?:\/[a-z0-9_-]+)+$/;

export function isWorkerRealm(normalizedPath: string): boolean {
  return WORKER_REALM.test(normalizedPath);
}

export function isCanonicalWorkerPath(rawPath: string): boolean {
  return CANONICAL_WORKER_PATH.test(rawPath);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 길이가 같은 두 문자열의 상수 시간 비교(길이가 다르면 false). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isWorkerConfigured(env: Env): boolean {
  return typeof env.ASK_WORKER_TOKEN_HASH === "string" && HEX64.test(env.ASK_WORKER_TOKEN_HASH);
}

/** DB 없이 하는 순수 토큰 대조. 가드와 라우트(이중 확인)가 함께 쓴다. */
export async function bearerMatches(request: Request, env: Env): Promise<boolean> {
  if (!isWorkerConfigured(env)) return false;
  const header = request.headers.get("Authorization");
  if (header === null) return false;
  const m = BEARER.exec(header);
  if (!m?.[1]) return false;
  const presented = await sha256Hex(m[1]);
  return constantTimeEqual(presented, (env.ASK_WORKER_TOKEN_HASH ?? "").toLowerCase());
}

export type WorkerAuthResult =
  { ok: true } | { ok: false; status: 401 | 429 | 503; retryAfterSec?: number };

const iso = (ms: number): string => new Date(ms).toISOString();

export async function authenticateWorker(
  request: Request,
  env: Env,
  nowMs: number,
): Promise<WorkerAuthResult> {
  if (!isWorkerConfigured(env)) return { ok: false, status: 503 };

  // 잠금 중이면 토큰이 맞아도 거절한다(맞는지 알려 주지 않는다).
  const lock = await env.DB.prepare("SELECT value FROM app_setting WHERE key = ?1")
    .bind(LOCK_KEY)
    .first<{ value: string }>();
  if (lock && lock.value > iso(nowMs)) {
    const retryAfterSec = Math.max(1, Math.ceil((Date.parse(lock.value) - nowMs) / 1000));
    return { ok: false, status: 429, retryAfterSec };
  }

  // 헤더가 아예 없는 요청(쿠키만 있는 브라우저 등)은 실패로 세지 않는다: 잠금으로 정당한 워커를 막는 수단이 되지 않게.
  if (request.headers.get("Authorization") === null) return { ok: false, status: 401 };
  if (await bearerMatches(request, env)) return { ok: true };

  const [, , count] = await env.DB.batch<{ c: number }>([
    env.DB.prepare("INSERT INTO worker_auth_fail (at) VALUES (?1)").bind(iso(nowMs)),
    env.DB.prepare("DELETE FROM worker_auth_fail WHERE at < ?1").bind(iso(nowMs - RETENTION_MS)),
    env.DB.prepare("SELECT COUNT(*) AS c FROM worker_auth_fail WHERE at > ?1").bind(
      iso(nowMs - WORKER_FAIL_LIMIT.windowMs),
    ),
  ]);
  if ((count?.results[0]?.c ?? 0) > WORKER_FAIL_LIMIT.maxFailures) {
    await env.DB.prepare(
      "INSERT INTO app_setting (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
      .bind(LOCK_KEY, iso(nowMs + WORKER_LOCK_MS))
      .run();
  }
  return { ok: false, status: 401 };
}
