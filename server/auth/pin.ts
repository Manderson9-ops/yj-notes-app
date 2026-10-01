// PIN 해시·대조 (docs/04 §3). PBKDF2-SHA256, 100000회(Workers WebCrypto 상한), 32바이트, base64.
// PIN hashing and constant-time verification using WebCrypto only.
import { base64ToBytes, bytesToBase64, utf8 } from "./encoding";

export const PBKDF2_ITERATIONS = 100_000;
const HASH_BITS = 256;

/** 4~12자리 숫자. 형식 오류는 틀린 PIN 과 같은 일반 401 로 처리한다(형식을 알려주지 않음). */
const PIN_PATTERN = /^[0-9]{4,12}$/;
/** 형식이 틀린 입력에도 같은 양의 PBKDF2 작업을 하기 위한 자리표시 값. */
const DUMMY_PIN = "000000";

export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export async function hashPin(pin: string, saltB64: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    HASH_BITS,
  );
  return bytesToBase64(new Uint8Array(bits));
}

/**
 * 상수 시간 비교(표준 API 만 사용). 길이가 달라도 긴 쪽 길이만큼 모두 순회하고,
 * 길이 차이는 누적 차이값에 섞어 마지막에 한 번만 판정한다.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * PIN 이 secret 의 해시와 같은지. 형식이 틀려도 PBKDF2 를 수행해 처리 시간을 맞춘다.
 * saltB64/expectedHashB64 가 올바른 base64 가 아니면 예외(설정 오류 -> 호출자가 500, fail closed).
 */
export async function verifyPin(
  pin: string,
  saltB64: string,
  expectedHashB64: string,
): Promise<boolean> {
  const formatOk = isValidPinFormat(pin);
  const candidate = await hashPin(formatOk ? pin : DUMMY_PIN, saltB64);
  const equal = timingSafeEqual(base64ToBytes(candidate), base64ToBytes(expectedHashB64));
  return formatOk && equal;
}
