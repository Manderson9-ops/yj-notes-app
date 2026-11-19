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

/**
 * 앱에 보이는 「워커 온라인」: seen 이 2분 안이거나, 리스가 살아 있는 작업(질문·턴 짧은 답·턴 카드)이 하나라도 있다.
 * 작업 중에는 claim 을 하지 않아 seen 이 끊길 수 있으므로 리스를 함께 본다. 상세 API 와 overview 가 같이 쓴다.
 * (seen 이 이미 온라인이면 EXISTS 를 읽지 않는다. 일시정지 상태 제외 조건은 T-Q4b.)
 */
export async function workerOnline(
  db: D1Database,
  nowMs: number,
): Promise<{ online: boolean; seenAt: string | null }> {
  const seen = await readWorkerSeen(db, nowMs);
  if (seen.online) return seen;
  const live = await db
    .prepare(
      `SELECT (
         EXISTS (SELECT 1 FROM ask_question WHERE deleted_at IS NULL AND status IN ('claimed','answering','reviewing') AND lease_until >= ?1)
         OR EXISTS (SELECT 1 FROM ask_turn WHERE deleted_at IS NULL AND status IN ('claimed','answering','reviewing') AND lease_until >= ?1)
         OR EXISTS (SELECT 1 FROM ask_turn WHERE deleted_at IS NULL AND card_status = 'pending' AND card_lease_until >= ?1)
       ) AS live`,
    )
    .bind(iso(nowMs))
    .first<{ live: number }>();
  return { online: live?.live === 1, seenAt: seen.seenAt };
}
