// 로그인 앞(첫 화면)에서 쓰는 응답 검사. 초기 번들을 줄이려고 zod 를 쓰지 않고 손으로 검사한다
// (zod 는 필요한 화면 묶음과 함께 내려받는다). 모양은 서버 응답(docs/05)과 같다.

/** zod 스키마와 같은 모양(parse)이라 api() 가 둘 다 받는다. */
export interface Parser<T> {
  parse: (data: unknown) => T;
}

export interface Session {
  authenticated: boolean;
  /** 서버 PIN_LENGTH 가 유효할 때만 옴(4~12). 이상한 값은 없는 것으로 본다(기존 4~12 + 확인 방식). */
  pinLength?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** GET /api/session */
export const sessionSchema: Parser<Session> = {
  parse(data) {
    if (!isRecord(data) || typeof data.authenticated !== "boolean") {
      throw new Error("invalid session response");
    }
    const n = data.pinLength;
    const valid = typeof n === "number" && Number.isInteger(n) && n >= 4 && n <= 12;
    return valid
      ? { authenticated: data.authenticated, pinLength: n }
      : { authenticated: data.authenticated };
  },
};

/** 오류 본문 {error, message}; 429 잠금은 retryAfterSec, 422 는 fields(칸 이름 -> 이유). 모양이 다르면 null. */
export interface ErrorBody {
  error: string;
  message?: string;
  retryAfterSec?: number;
  fields?: Record<string, string>;
}

export function parseErrorBody(data: unknown): ErrorBody | null {
  if (!isRecord(data) || typeof data.error !== "string") return null;
  const out: ErrorBody = { error: data.error };
  if (typeof data.message === "string") out.message = data.message;
  const r = data.retryAfterSec;
  if (typeof r === "number" && Number.isInteger(r) && r >= 0) out.retryAfterSec = r;
  if (isRecord(data.fields) && Object.values(data.fields).every((v) => typeof v === "string")) {
    out.fields = data.fields as Record<string, string>;
  }
  return out;
}
