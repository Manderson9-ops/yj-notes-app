// 알림장 자동 업데이트(sync_run) 상태 판정 — 순수 함수 (docs/09 「자동 업데이트」).
// 기준은 한국 표준시(KST, UTC+9, 서머타임 없음). 매일 20:00 KST 가 「예정 시각」이다.
import {
  EARLY_GRACE_MS,
  KST_OFFSET_MS,
  MISSED_AFTER_MS,
  SCHEDULE_HOUR_KST,
  STUCK_AFTER_MS,
  SYNC_RETENTION_MS,
} from "../../shared/sync-schedule";

export type SyncState = "none" | "ok" | "running" | "failed" | "missed" | "stuck";

export interface SyncRunRow {
  id: number;
  started_at: string;
  /** 서버가 시작 보고를 받은 시각(ISO). 집 PC 시계가 어긋나도 믿을 수 있는 기준. */
  created_at: string;
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
  /** 가장 최근 실행의 시작 보고를 서버가 받은 시각(ISO). 집 PC 시계와 무관해 화면의 「오늘/어제」 판단에 쓴다. */
  lastAttemptReceivedAt: string | null;
  /** 마지막 성공 실행이 새로 가져온 알림장 수. */
  newReports: number;
  /** 마지막으로 반영된 알림장 날짜(YYYY-MM-DD). 모르면 null. */
  lastNoteDate: string | null;
  /** 실패·미실행 사유 코드(failed: 보고된 코드, missed/stuck: 같은 이름). 아니면 null. */
  code: string | null;
}

const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;
// 시각 규칙은 화면 문구와 공유한다(shared/sync-schedule.ts).
export { EARLY_GRACE_MS, MISSED_AFTER_MS, STUCK_AFTER_MS, SYNC_RETENTION_MS };

/** nowMs 이전(같은 순간 포함)에서 가장 가까운 20:00 KST 의 UTC ms. */
export function lastScheduledMs(nowMs: number): number {
  const kstDayStart = Math.floor((nowMs + KST_OFFSET_MS) / DAY) * DAY - KST_OFFSET_MS;
  const today = kstDayStart + SCHEDULE_HOUR_KST * HOUR;
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
    lastAttemptReceivedAt: latest?.created_at ?? null,
    newReports: lastSuccess?.new_reports ?? 0,
    lastNoteDate,
  };
  if (!latest) return { ...base, state: "none", code: null };

  // 판정은 서버가 시작 보고를 받은 시각(created_at)으로 한다: 집 PC 시계가 틀려도 미실행·멈춤이 어긋나지 않게.
  const receivedMs = Date.parse(latest.created_at);
  const scheduled = lastScheduledMs(nowMs);
  // 예정 시각(−30분 여유) 이후에 시작 보고가 없고 90분이 지났다.
  if (receivedMs < scheduled - EARLY_GRACE_MS && nowMs >= scheduled + MISSED_AFTER_MS) {
    return { ...base, state: "missed", code: "missed" };
  }
  if (latest.status === "running") {
    return nowMs - receivedMs > STUCK_AFTER_MS
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
    "id, started_at, created_at, finished_at, status, code, new_reports, new_comments, last_note_date";
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
