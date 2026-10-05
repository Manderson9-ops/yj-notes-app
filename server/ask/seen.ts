// 워커 생존 표시 (app_setting.ask_worker_seen_at). D1 쓰기를 아끼려고 최대 60초에 한 번만 갱신한다.
export const WORKER_SEEN_KEY = "ask_worker_seen_at";
export const SEEN_WRITE_INTERVAL_MS = 60_000;
export const ONLINE_WINDOW_MS = 2 * 60_000;

const iso = (ms: number): string => new Date(ms).toISOString();

/** 마지막 갱신이 60초보다 오래됐을 때만 쓴다(ISO 고정 폭이라 문자열 비교 = 시간 순서). */
export async function touchWorkerSeen(db: D1Database, nowMs: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_setting (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE app_setting.value < ?3`,
    )
    .bind(WORKER_SEEN_KEY, iso(nowMs), iso(nowMs - SEEN_WRITE_INTERVAL_MS))
    .run();
}

export async function readWorkerSeen(
  db: D1Database,
  nowMs: number,
): Promise<{ online: boolean; seenAt: string | null }> {
  const row = await db
    .prepare("SELECT value FROM app_setting WHERE key = ?1")
    .bind(WORKER_SEEN_KEY)
    .first<{ value: string }>();
  const seenAt = row?.value ?? null;
  const t = seenAt === null ? Number.NaN : Date.parse(seenAt);
  return { online: Number.isFinite(t) && nowMs - t <= ONLINE_WINDOW_MS, seenAt };
}
