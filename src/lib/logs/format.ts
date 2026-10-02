// 날짜·값 표시. 날짜 문자열(YYYY-MM-DD)은 시간대 변환 없이 달력 값으로만 다룬다.
import type { LogField, LogType } from "./schemas";

const DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 오늘(한국 시간) YYYY-MM-DD */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "2020년 3월 2일 (월)" — withYear=false 면 연도 생략 */
export function formatDate(date: string, withYear = true): string {
  const d = new Date(`${date}T00:00:00Z`);
  const md = `${String(d.getUTCMonth() + 1)}월 ${String(d.getUTCDate())}일 (${DOW[d.getUTCDay()] ?? ""})`;
  return withYear ? `${String(d.getUTCFullYear())}년 ${md}` : md;
}

/** 올해 날짜는 연도를 생략한 짧은 표기 */
export function formatDateShort(date: string, today: string = todayKst()): string {
  return formatDate(date, date.slice(0, 4) !== today.slice(0, 4));
}

/** "3/10" */
export function formatMonthDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${String(d.getUTCMonth() + 1)}/${String(d.getUTCDate())}`;
}

export function formatValue(field: LogField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return field.type === "int" ? `${text}${field.unit ?? ""}` : text;
}

/** 목록용 한 줄 요약: 정의의 summary.highlight(없으면 enum·int 전부)를 "라벨 값" 으로 */
export function summarizePayload(type: LogType, payload: Record<string, unknown>): string {
  const keys =
    type.schema.summary?.highlight ??
    type.schema.fields.filter((f) => f.type !== "text").map((f) => f.key);
  const parts: string[] = [];
  for (const k of keys) {
    const f = type.schema.fields.find((x) => x.key === k);
    if (!f || payload[k] === undefined) continue;
    parts.push(`${f.label_ko} ${formatValue(f, payload[k])}`);
  }
  return parts.join(" · ");
}

/**
 * 가이드 경로("guide/05#3-1")를 앱 안 링크로: `/library/doc/guide-05#3-1`.
 * 문서 주소는 적재 도구 규칙(`<폴더>-<번호>`, tools/ingest/model.py doc_slug)과 같다. `#` 뒤는 절 번호다.
 */
export function guideHref(guide: string): string {
  const [path = "", anchor] = guide.split("#");
  const slug = path.split("/").filter(Boolean).join("-").toLowerCase();
  return `/library/doc/${slug}${anchor ? `#${anchor}` : ""}`;
}
