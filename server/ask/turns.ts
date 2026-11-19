// 물어보기 대화(T-Q5) 서버 공용: 리스·시도 상수, 상태 묶음 SQL 조각, 저장된 JSON 안전 파싱.
// 질문·답·대화 글은 로그·오류에 쓰지 않는다.
import { AnswerSchema, FollowupSchema, type Answer, type Followup } from "../../shared/ask-schema";

export const LEASE_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
/** 워커가 잡고 있는 짧은 답 단계 상태(질문·턴 공통). */
export const WORKER_ACTIVE = "('claimed','answering','reviewing')";
/** 대기까지 포함한 활성 상태. 앱 입력 잠금·threadActive 의 기준(카드 단계 `card_status='pending'` 은 따로 더한다). */
export const TURN_ACTIVE = "('pending','claimed','answering','reviewing')";

/** 별칭 a 의 ask_question 이 위급 잠금인가(red_lock 또는 red_flag — 마이그레이션 이전에 생긴 위급 질문도 잠긴다). */
export const lockedSql = (alias: string): string =>
  `(${alias}.red_lock = 1 OR ${alias}.red_flag = 1)`;

/** 활성 턴: 짧은 답 단계가 끝나지 않았거나 카드를 만드는 중(별칭 a). */
export const activeTurnSql = (alias: string): string =>
  `(${alias}.status IN ${TURN_ACTIVE} OR ${alias}.card_status = 'pending')`;

/** 저장된 짧은 답 JSON. 비었거나 깨졌으면 null. */
export function parseFollowup(json: string | null): Followup | null {
  if (json === null) return null;
  try {
    const p = FollowupSchema.safeParse(JSON.parse(json));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** 저장된 답 카드 JSON. 비었거나 깨졌으면 null. */
export function parseCard(json: string | null): Answer | null {
  if (json === null) return null;
  try {
    const p = AnswerSchema.safeParse(JSON.parse(json));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** 객체 안의 모든 문자열(금지어 검사용). */
export function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (typeof v === "object" && v !== null)
    for (const x of Object.values(v)) collectStrings(x, out);
}

/** D1·SQLite 의 UNIQUE 위반인가(seq 경합 판별). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE/i.test(e.message);
}
