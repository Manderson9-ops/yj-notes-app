// 알림장 자동 업데이트(sync_run) 상태 판정 — 순수 함수 (docs/09 「자동 업데이트」).
// 기준은 한국 표준시(KST, UTC+9, 서머타임 없음). 매일 20:00 KST 가 「예정 시각」이다.
export type SyncState = "none" | "ok" | "running" | "failed" | "missed" | "stuck";

export interface SyncRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "no_new" | "failed";
  code: string | null;
  new_reports: number | null;
  new_comments: number | null;
  last_note_date: string | null;
}

export interface SyncSummary {
  state: SyncState;
  /** 마지막 성공(ok·no_new) 끝난 시각(ISO). 없으면 null. */
  lastOkAt: string | null;
  /** 가장 최근 실행을 시작한 시각(ISO). 없으면 null. */
  lastAttemptAt: string | null;
  /** 마지막 성공 실행이 새로 가져온 알림장 수. */
  newReports: number;
  /** 마지막으로 반영된 알림장 날짜(YYYY-MM-DD). 모르면 null. */
  lastNoteDate: string | null;
  /** 실패·미실행 사유 코드(failed: 보고된 코드, missed/stuck: 같은 이름). 아니면 null. */
  code: string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KST_OFFSET_MS = 9 * HOUR;
/** 예정 시각 20:00 KST. */
const SCHEDULE_HOUR = 20;
/** 예정 시각 뒤 이 시간 안에 시작 기록이 없으면 「실행되지 않음」. */
export const MISSED_AFTER_MS = 90 * MIN;
/** 시작 뒤 이 시간이 지나도 끝나지 않으면 「멈춤」. */
export const STUCK_AFTER_MS = 3 * HOUR;
export const SYNC_RETENTION_MS = 90 * DAY;

/** nowMs 이전(같은 순간 포함)에서 가장 가까운 20:00 KST 의 UTC ms. */
export function lastScheduledMs(nowMs: number): number {
  const kstDayStart = Math.floor((nowMs + KST_OFFSET_MS) / DAY) * DAY - KST_OFFSET_MS;
  const today = kstDayStart + SCHEDULE_HOUR * HOUR;
  return nowMs >= today ? today : today - DAY;
}

const CODE = /^[a-z0-9_]{1,40}$/;
const safeCode = (c: string | null): string | null => (c !== null && CODE.test(c) ? c : null);

/**
 * latest: 가장 최근(id 가 큰) 실행. lastSuccess: 가장 최근 ok·no_new 실행. lastNoteDate: 성공 실행 중 날짜가 있는 가장 최근 값.
 * 행이 하나도 없으면(latest=null) 「none」 — 첫 실행 전에는 알리지 않는다.
 */
export function deriveSyncSummary(
  latest: SyncRunRow | null,
  lastSuccess: SyncRunRow | null,
  lastNoteDate: string | null,
  nowMs: number,
): SyncSummary {
  const base = {
    lastOkAt: lastSuccess ? (lastSuccess.finished_at ?? lastSuccess.started_at) : null,
    lastAttemptAt: latest?.started_at ?? null,
    newReports: lastSuccess?.new_reports ?? 0,
    lastNoteDate,
  };
  if (!latest) return { ...base, state: "none", code: null };

  const startedMs = Date.parse(latest.started_at);
  const scheduled = lastScheduledMs(nowMs);
  // 예정 시각 이후 시작된 실행이 없고 90분이 지났다.
  if (startedMs < scheduled && nowMs >= scheduled + MISSED_AFTER_MS) {
    return { ...base, state: "missed", code: "missed" };
  }
  if (latest.status === "running") {
    return nowMs - startedMs > STUCK_AFTER_MS
      ? { ...base, state: "stuck", code: "stuck" }
      : { ...base, state: "running", code: null };
  }
  if (latest.status === "failed") {
    return { ...base, state: "failed", code: safeCode(latest.code) ?? "unknown" };
  }
  return { ...base, state: "ok", code: null };
}

export async function readSyncSummary(db: D1Database, nowMs: number): Promise<SyncSummary> {
  const cols =
    "id, started_at, finished_at, status, code, new_reports, new_comments, last_note_date";
  const latest = await db
    .prepare(`SELECT ${cols} FROM sync_run ORDER BY id DESC LIMIT 1`)
    .first<SyncRunRow>();
  if (!latest) return deriveSyncSummary(null, null, null, nowMs);
  const lastSuccess = await db
    .prepare(
      `SELECT ${cols} FROM sync_run WHERE status IN ('ok','no_new') ORDER BY id DESC LIMIT 1`,
    )
    .first<SyncRunRow>();
  const note = await db
    .prepare(
      "SELECT last_note_date FROM sync_run WHERE status IN ('ok','no_new') AND last_note_date IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .first<{ last_note_date: string }>();
  return deriveSyncSummary(latest, lastSuccess, note?.last_note_date ?? null, nowMs);
}
