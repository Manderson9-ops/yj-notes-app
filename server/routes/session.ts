// /api/session (로그인·상태·로그아웃)와 /api/health (docs/05 인증 절). 이 라우트들만 세션 없이 호출 가능.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { isPinConfigured, parsePinLength, verifyPin } from "../auth/pin";
import { beginAttempt, hashIp, markSuccess, voidAttempt } from "../auth/ratelimit";
import {
  buildClearCookie,
  buildSessionCookie,
  createSessionToken,
  isAuthenticated,
  readSessionEpoch,
} from "../auth/session";
import { errorResponse, jsonResponse } from "../http/errors";
import { readIngestState } from "../lib/ingest-state";

/** 성공·실패 모두 응답이 이 시간 이상 걸리게 한다 (docs/04 §3 "실패 응답 지연 일정"). */
export const MIN_LOGIN_MS = 400;

const LoginBody = z.object({ pin: z.string().max(64) });

export const sessionRoutes = new Hono<AppEnv>();

sessionRoutes.post("/api/session", async (c) => {
  const { now, sleep } = c.get("deps");
  const startedAt = now();

  // 본문 모양이 틀린 요청(PIN 형식 문제가 아님)은 시도로 세지 않는다.
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(400, "bad_request", "잘못된 요청이에요.");
  }
  const parsed = LoginBody.safeParse(body);
  if (!parsed.success) return errorResponse(400, "bad_request", "잘못된 요청이에요.");

  const env = c.env;
  // 서버 설정 오류(PIN 비밀값 없음)는 시도로 세지 않는다: 기록·잠금 계산 전에 500 (fail closed).
  if (!isPinConfigured(env)) throw new Error("PIN_HASH/PIN_SALT not configured");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);

  // 잠금 확인은 PIN 검증보다 먼저, 시도 기록과 한 문장으로(원자적).
  const attempt = await beginAttempt(env.DB, ipHash, startedAt);
  if (!attempt.allowed) {
    return errorResponse(
      429,
      "locked",
      "시도 횟수가 너무 많아요. 잠시 후 다시 시도해 주세요.",
      { retryAfterSec: attempt.retryAfterSec },
      { "Retry-After": String(attempt.retryAfterSec) },
    );
  }

  let ok: boolean;
  try {
    ok = await verifyPin(parsed.data.pin, env.PIN_SALT, env.PIN_HASH);
  } catch (e) {
    // 대조 자체가 못 된 것(PIN_HASH/PIN_SALT 형식 오류 등)은 틀린 PIN 이 아니다 -> 기록을 되돌리고 500.
    await voidAttempt(env.DB, attempt.attemptId);
    throw e;
  }

  let cookie: string | null = null;
  if (ok) {
    await markSuccess(env.DB, attempt.attemptId);
    const epoch = await readSessionEpoch(env.DB);
    if (epoch === null) throw new Error("session_epoch missing"); // 설정 오류 -> 500 (fail closed)
    cookie = buildSessionCookie(await createSessionToken(env.SESSION_SECRET, epoch, now()));
  }

  // 균일 지연: 성공·실패 모두 최소 MIN_LOGIN_MS.
  const remaining = MIN_LOGIN_MS - (now() - startedAt);
  if (remaining > 0) await sleep(remaining);

  if (cookie === null) return errorResponse(401, "invalid_pin", "PIN 이 맞지 않아요.");
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie } });
});

sessionRoutes.get("/api/session", async (c) => {
  const authenticated = await isAuthenticated(c.req.raw, c.env, c.get("deps").now());
  // pinLength: 유효한 PIN_LENGTH 일 때만, 세션 유무와 무관하게 포함(로그인 화면용).
  const pinLength = parsePinLength(c.env.PIN_LENGTH);
  return jsonResponse(
    200,
    pinLength === undefined ? { authenticated } : { authenticated, pinLength },
  );
});

sessionRoutes.delete("/api/session", () => {
  return new Response(null, { status: 204, headers: { "Set-Cookie": buildClearCookie() } });
});

sessionRoutes.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT finished_at FROM ingest_run WHERE status = 'ok' ORDER BY id DESC LIMIT 1",
  ).first<{ finished_at: string | null }>();
  return jsonResponse(200, {
    ok: true,
    version: c.env.APP_VERSION ?? "dev",
    lastIngestAt: row?.finished_at ?? null,
    // R1-6: 공개 응답이라 자료 없이 불리언 하나만(갱신 중이면 true).
    updating: (await readIngestState(c.env.DB, c.get("deps").now())) === "running",
  });
});
