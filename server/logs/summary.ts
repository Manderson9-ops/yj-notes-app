// 기록 요약(F2-4): 주차 비교·교차표·경고 건수. 기존 엑셀 기록표와 같은 정의:
//  - 주차: `from` 날짜부터 7일씩 끊은 구간(1주차 = from~from+6일). from 이 없으면 가장 이른 기록일.
//  - 주차별 지표: 기록 수 / enum 필드는 값별 개수 / int 필드는 개수·합·평균(소수 첫째 자리)·최대.
//  - 교차표: 행 필드 × 열 필드의 개수(정의의 summary.crosstabs). 선택지 순서는 정의 순서.
//  - 경고: 정의의 alerts 규칙에 걸린 (기록, 규칙) 쌍의 수.
// 숫자는 전부 기록에서 센다(P3). 순수 함수 — 서버 라우트와 dev mock 이 같이 쓴다.
import { evaluateAlerts, type LogTypeDefinition } from "./definition";

export interface SummaryLog {
  id: string;
  type: string;
  occurredOn: string;
  payload: Record<string, unknown>;
}

export type FieldStat =
  | { kind: "enum"; counts: Record<string, number> }
  | { kind: "int"; n: number; sum: number; avg: number | null; max: number | null };

export interface WeekSummary {
  index: number;
  start: string;
  end: string;
  count: number;
  fields: Record<string, FieldStat>;
}

export interface CrosstabSummary {
  rows: string;
  cols: string;
  rowLabel: string;
  colLabel: string;
  rowOptions: string[];
  colOptions: string[];
  /** cells[r][c] = 행 r·열 c 에 해당하는 기록 수 */
  cells: number[][];
}

export interface SummaryAlert {
  logId: string;
  type: string;
  occurredOn: string;
  field: string;
  message: string;
  guide: string;
}

export interface LogsSummary {
  type: string | null;
  from: string | null;
  to: string | null;
  total: number;
  weeks: WeekSummary[];
  crosstabs: CrosstabSummary[];
  alerts: SummaryAlert[];
  alertCount: number;
}

export const MAX_WEEKS = 53;
const DAY_MS = 86_400_000;

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 그 날짜가 속한 월~일 주의 시작일(월요일)과 끝일(일요일). "이번 주 N번째 기록" 에 쓴다. */
export function mondayWeekOf(date: string): { start: string; end: string } {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=일
  const start = addDays(date, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export function computeSummary(input: {
  type: string | null;
  from: string | null;
  to: string | null;
  logs: SummaryLog[];
  /** 종류 코드 -> 정의 */
  defs: ReadonlyMap<string, LogTypeDefinition>;
}): LogsSummary {
  const { type, defs } = input;
  const logs = input.logs.filter((l) => type === null || l.type === type);
  const dates = logs.map((l) => l.occurredOn).sort();
  const from = input.from ?? dates[0] ?? null;
  const to = input.to ?? dates[dates.length - 1] ?? null;
  const def = type === null ? undefined : defs.get(type);

  const weeks: WeekSummary[] = [];
  if (from !== null && to !== null && from <= to) {
    const span = Math.floor((dayNumber(to) - dayNumber(from)) / 7) + 1;
    for (let i = 0; i < Math.min(span, MAX_WEEKS); i++) {
      weeks.push({
        index: i + 1,
        start: addDays(from, i * 7),
        end: addDays(from, i * 7 + 6),
        count: 0,
        fields: {},
      });
    }
  }

  const keys =
    def === undefined
      ? []
      : (def.summary?.highlight ?? def.fields.filter((f) => f.type !== "text").map((f) => f.key));
  const fieldDefs = new Map((def?.fields ?? []).map((f) => [f.key, f]));

  for (const w of weeks) {
    for (const k of keys) {
      const f = fieldDefs.get(k);
      if (f?.type === "enum") {
        w.fields[k] = { kind: "enum", counts: Object.fromEntries(f.options.map((o) => [o, 0])) };
      } else if (f?.type === "int") {
        w.fields[k] = { kind: "int", n: 0, sum: 0, avg: null, max: null };
      }
    }
  }

  const inRange = logs.filter(
    (l) => from !== null && to !== null && l.occurredOn >= from && l.occurredOn <= to,
  );
  for (const l of inRange) {
    const idx = Math.floor((dayNumber(l.occurredOn) - dayNumber(from as string)) / 7);
    const w = weeks[idx];
    if (w === undefined) continue;
    w.count += 1;
    for (const [k, stat] of Object.entries(w.fields)) {
      const v = l.payload[k];
      if (stat.kind === "enum" && typeof v === "string" && v in stat.counts) {
        stat.counts[v] = (stat.counts[v] ?? 0) + 1;
      } else if (stat.kind === "int" && typeof v === "number") {
        stat.n += 1;
        stat.sum += v;
        stat.max = stat.max === null ? v : Math.max(stat.max, v);
      }
    }
  }
  for (const w of weeks) {
    for (const stat of Object.values(w.fields)) {
      if (stat.kind === "int" && stat.n > 0) stat.avg = Math.round((stat.sum / stat.n) * 10) / 10;
    }
  }

  const crosstabs: CrosstabSummary[] = [];
  for (const spec of def?.summary?.crosstabs ?? []) {
    const r = fieldDefs.get(spec.rows);
    const c = fieldDefs.get(spec.cols);
    if (r?.type !== "enum" || c?.type !== "enum") continue;
    const cells = r.options.map(() => c.options.map(() => 0));
    for (const l of inRange) {
      const ri = r.options.indexOf(String(l.payload[spec.rows]));
      const ci = c.options.indexOf(String(l.payload[spec.cols]));
      const row = cells[ri];
      if (ri >= 0 && ci >= 0 && row !== undefined) row[ci] = (row[ci] ?? 0) + 1;
    }
    crosstabs.push({
      rows: spec.rows,
      cols: spec.cols,
      rowLabel: r.label_ko,
      colLabel: c.label_ko,
      rowOptions: r.options,
      colOptions: c.options,
      cells,
    });
  }

  const alerts: SummaryAlert[] = [];
  for (const l of inRange) {
    const d = defs.get(l.type);
    if (d === undefined) continue;
    for (const a of evaluateAlerts(d, l.payload)) {
      alerts.push({ logId: l.id, type: l.type, occurredOn: l.occurredOn, ...a });
    }
  }
  alerts.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || a.logId.localeCompare(b.logId));

  return {
    type,
    from,
    to,
    total: inRange.length,
    weeks,
    crosstabs,
    alerts,
    alertCount: alerts.length,
  };
}
