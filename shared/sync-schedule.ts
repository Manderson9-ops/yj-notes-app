// 알림장 자동 업데이트 시각 규칙 — 서버 판정(server/lib/sync-state.ts)과 화면 문구(src/lib/syncText.ts)가 같은 값을 쓴다.
// 기준은 한국 표준시(KST, UTC+9, 서머타임 없음).
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const KST_OFFSET_MS = 9 * HOUR;
/** 예정 시각: 매일 20:00 KST. */
export const SCHEDULE_HOUR_KST = 20;
/** 예정 시각보다 이만큼 일찍 서버에 닿은 시작 보고도 오늘 실행으로 센다(수동 실행·시계 오차). */
export const EARLY_GRACE_MS = 30 * MIN;
/** 예정 시각 뒤 이 시간이 지나도 시작 보고가 없으면 「실행되지 않음」. */
export const MISSED_AFTER_MS = 90 * MIN;
/** 시작 뒤 이 시간이 지나도 끝나지 않으면 「멈춤」. */
export const STUCK_AFTER_MS = 3 * HOUR;
/** 실행 기록 보관 기간(시작 보고 때 정리). */
export const SYNC_RETENTION_MS = 90 * DAY;
