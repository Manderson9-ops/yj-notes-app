// 한국식 날짜 표기. 입력은 API 의 YYYY-MM-DD(시간대 변환 없음).
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parts(date: string): { y: number; m: number; d: number } {
  const [y = 0, m = 0, d = 0] = date.split("-").map(Number);
  return { y, m, d };
}

export function weekdayKo(date: string): string {
  const { y, m, d } = parts(date);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** 2020년 3월 2일 (월) */
export function formatDateKo(date: string): string {
  const { y, m, d } = parts(date);
  return `${String(y)}년 ${String(m)}월 ${String(d)}일 (${weekdayKo(date)})`;
}

/** 3월 2일 (월) — 목록 줄 */
export function formatShortKo(date: string): string {
  const { m, d } = parts(date);
  return `${String(m)}월 ${String(d)}일 (${weekdayKo(date)})`;
}

/** 2020년 3월 — 월 구분 머리글 */
export function monthLabelKo(date: string): string {
  const { y, m } = parts(date);
  return `${String(y)}년 ${String(m)}월`;
}

export const ageLabel = (months: number): string => `${String(months)}개월`;

/** YYYY-MM-DD 에서 개월 수를 뺀 날짜(일자는 월말로 맞춘다). 기간 칩 계산용. */
export function minusMonths(date: string, months: number): string {
  const { y, m, d } = parts(date);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** "2020-03-02 16:10" -> "16:10" */
export const timeOf = (postedAt: string): string => /\d{2}:\d{2}/.exec(postedAt)?.[0] ?? "";

/** ISO 시각이 지금보다 며칠 전인지(내림). */
export function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}
