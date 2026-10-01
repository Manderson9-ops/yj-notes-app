// 세션 쿠키 `yjs` (docs/04 §3): base64url(payload) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payloadPart)).
// payload = {v:1, epoch, iat, exp, dev}. 서버는 app_setting.session_epoch 와 같을 때만 수락한다.
// Session cookie signing/verification. Secrets and cookie values are never logged.
import { z } from "zod";
import type { Env } from "../env";
import { base64UrlToBytes, bytesToBase64Url, utf8 } from "./encoding";

export const COOKIE_NAME = "yjs";
/** 30일 */
export const SESSION_MAX_AGE_SEC = 2_592_000;

const PayloadSchema = z.strictObject({
  v: z.literal(1),
  epoch: z.number().int().nonnegative(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  dev: z.string().min(1).max(64),
});
export type SessionPayload = z.infer<typeof PayloadSchema>;

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

/** 새 세션 토큰. dev = 이 기기 식별용 무작위 16바이트(b64url). */
export async function createSessionToken(
  secret: string,
  epoch: number,
  nowMs: number,
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    v: 1,
    epoch,
    iat,
    exp: iat + SESSION_MAX_AGE_SEC,
    dev: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const payloadPart = bytesToBase64Url(utf8(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), utf8(payloadPart));
  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/**
 * 서명·형식·만료를 확인한다(epoch 는 따로). 실패 사유는 구분하지 않고 null.
 * 서명 비교는 WebCrypto `subtle.verify`(상수 시간)로 한다. 서명이 맞은 뒤에만 payload 를 파싱한다.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number,
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts as [string, string];
  const sig = base64UrlToBytes(sigPart);
  const payloadBytes = base64UrlToBytes(payloadPart);
  if (!sig || !payloadBytes || sig.length !== 32) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    sig,
    utf8(payloadPart),
  );
  if (!valid) return null;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.exp <= Math.floor(nowMs / 1000)) return null;
  return parsed.data;
}

/** app_setting.session_epoch. 없거나 숫자가 아니면 null(= 모두 거부). 요청 안에서만 쓰고 캐시하지 않는다. */
export async function readSessionEpoch(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT value FROM app_setting WHERE key = ?1")
    .bind("session_epoch")
    .first<{ value: string }>();
  if (!row || !/^[0-9]+$/.test(row.value)) return null;
  return Number(row.value);
}

export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Pages 미들웨어와 GET /api/session 이 공유하는 판정. */
export async function isAuthenticated(request: Request, env: Env, nowMs: number): Promise<boolean> {
  const token = getCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (!token) return false;
  const payload = await verifySessionToken(token, env.SESSION_SECRET, nowMs);
  if (!payload) return false;
  const epoch = await readSessionEpoch(env.DB);
  return epoch !== null && payload.epoch === epoch;
}

/**
 * HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=30일.
 * 로컬 http 개발에서도 Secure 를 유지한다: 브라우저(Chrome/Firefox)는 http://localhost 에서도
 * Secure 쿠키를 저장·전송한다. (curl 은 쿠키 항아리가 거부할 수 있어 헤더로 직접 전달한다.)
 */
export function buildSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${String(SESSION_MAX_AGE_SEC)}`;
}

export function buildClearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
