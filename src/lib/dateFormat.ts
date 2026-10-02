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

/** "2020-03-02 16:10" -> "오후 4:10" (조부모에게 24시간 표기는 낯설다). 시각이 없으면 "". */
export function timeKo(postedAt: string): string {
  const m = /(\d{2}):(\d{2})/.exec(postedAt);
  if (!m) return "";
  const h = Number(m[1]);
  const half = h < 12 ? "오전" : "오후";
  return `${half} ${String(h % 12 === 0 ? 12 : h % 12)}:${m[2] ?? "00"}`;
}

/** ISO 시각이 지금보다 며칠 전인지(내림). */
export function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2020-02" -> "2020-02-29" (그 달 마지막 날) */
export function monthEnd(month: string): string {
  const [y = 0, m = 0] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** 두 날짜가 걸친 달 목록, 최근 달이 앞. "2020-03-05","2020-05-01" -> ["2020-05","2020-04","2020-03"] */
export function monthsDesc(from: string, to: string): string[] {
  const [fy = 0, fm = 0] = from.split("-").map(Number);
  const [ty = 0, tm = 0] = to.split("-").map(Number);
  const out: string[] = [];
  for (let t = ty * 12 + (tm - 1); t >= fy * 12 + (fm - 1); t -= 1) {
    out.push(
      `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}`,
    );
  }
  return out;
}

/** "2020-03" -> "2020년 3월" */
export const monthLabelOf = (month: string): string => monthLabelKo(`${month}-01`);
