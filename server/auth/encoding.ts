// base64 / base64url 보조 함수 (표준 API 만 사용: btoa/atob/TextEncoder).
// Standard-API-only base64 helpers shared by PIN hashing and session cookies.

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** 잘못된 입력이면 예외(atob). 설정값(PIN_HASH/PIN_SALT) 용 — 잘못되면 fail closed. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** 쿠키처럼 신뢰할 수 없는 입력용: 잘못되면 null (예외 없음). */
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded =
    text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4);
  try {
    return base64ToBytes(padded);
  } catch {
    return null;
  }
}
