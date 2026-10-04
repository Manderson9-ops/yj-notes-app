// PIN 시도 제한 (docs/04 §2·§3). auth_attempt 에는 IP 의 솔트 해시만 저장한다.
// 규칙: IP 당 15분 안 실패 5회 이상 -> 잠금, 전체 60분 안 실패 30회 이상 -> 전체 잠금.
// 잠금 해제 시각 = 잠금을 일으킨 윈도 안 "마지막 실패" + 윈도 길이 (그 시점엔 윈도 안 실패가 0 이 된다).
//
// 경쟁 조건 방지: 확인과 기록을 분리하면 동시 요청 수백 개가 모두 "아직 안 잠김"을 보고 PIN 을 시도할 수
// 있다. 그래서 "잠금 아님" 조건과 INSERT 를 한 SQL 문(INSERT ... SELECT ... WHERE 개수 < 한도)으로 묶어
// 원자적으로 시도 1건을 먼저 '실패(ok=0)'로 기록한다. 삽입되지 않으면 잠금 상태 -> PIN 검증 없이 429.
// PIN 이 맞으면 같은 행을 ok=1 로 바꾼다. 잠금 중 시도는 기록하지 않아 잠금이 연장되지 않는다.
import { bytesToBase64Url, utf8 } from "./encoding";

export const IP_LIMIT = { maxFailures: 5, windowMs: 15 * 60_000 } as const;
export const GLOBAL_LIMIT = { maxFailures: 30, windowMs: 60 * 60_000 } as const;
export const RETENTION_MS = 30 * 24 * 60 * 60_000;

/** at 컬럼은 고정 폭 ISO(UTC)라 문자열 비교가 시간 순서와 같다. */
const iso = (ms: number): string => new Date(ms).toISOString();

export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(ip))));
}

export type AttemptResult =
  { allowed: true; attemptId: number } | { allowed: false; retryAfterSec: number };

interface CountRow {
  c: number;
  m: string | null;
}

/**
 * 시도 1건을 원자적으로 '실패'로 기록한다. 잠금이면 allowed:false(기록 없음).
 * 같은 배치에서 30일 지난 행을 지운다(opportunistic cleanup).
 * 참고: auth_attempt 에는 (ip_hash, at) 인덱스만 있어 전역 집계·정리 쿼리는 `at` 으로 훑는다.
 * 행 수가 30일치로 작아 허용한다(필요하면 at 단독 인덱스를 docs/03 과 함께 추가).
 */
export async function beginAttempt(
  db: D1Database,
  ipHash: string,
  nowMs: number,
): Promise<AttemptResult> {
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO auth_attempt (ip_hash, at, ok)
         SELECT ?1, ?2, 0
         WHERE (SELECT COUNT(*) FROM auth_attempt WHERE ip_hash = ?1 AND ok = 0 AND at > ?3) < ?4
           AND (SELECT COUNT(*) FROM auth_attempt WHERE ok = 0 AND at > ?5) < ?6`,
      )
      .bind(
        ipHash,
        iso(nowMs),
        iso(nowMs - IP_LIMIT.windowMs),
        IP_LIMIT.maxFailures,
        iso(nowMs - GLOBAL_LIMIT.windowMs),
        GLOBAL_LIMIT.maxFailures,
      ),
    db.prepare("DELETE FROM auth_attempt WHERE at < ?1").bind(iso(nowMs - RETENTION_MS)),
  ]);

  if (insert?.meta.changes === 1) {
    return { allowed: true, attemptId: insert.meta.last_row_id };
  }
  return { allowed: false, retryAfterSec: await lockRetryAfterSec(db, ipHash, nowMs) };
}

async function lockRetryAfterSec(db: D1Database, ipHash: string, nowMs: number): Promise<number> {
  const [ip, global] = await db.batch<CountRow>([
    db
      .prepare(
        "SELECT COUNT(*) AS c, MAX(at) AS m FROM auth_attempt WHERE ip_hash = ?1 AND ok = 0 AND at > ?2",
      )
      .bind(ipHash, iso(nowMs - IP_LIMIT.windowMs)),
    db
      .prepare("SELECT COUNT(*) AS c, MAX(at) AS m FROM auth_attempt WHERE ok = 0 AND at > ?1")
      .bind(iso(nowMs - GLOBAL_LIMIT.windowMs)),
  ]);
  let untilMs = nowMs + 1000; // 경쟁으로 잠금이 막 풀린 경우의 최소 안내값
  const consider = (
    row: CountRow | undefined,
    limit: { maxFailures: number; windowMs: number },
  ) => {
    if (row?.m && row.c >= limit.maxFailures) {
      untilMs = Math.max(untilMs, Date.parse(row.m) + limit.windowMs);
    }
  };
  consider(ip?.results[0], IP_LIMIT);
  consider(global?.results[0], GLOBAL_LIMIT);
  // R1-3: 전체 잠금이면 잠금을 일으킨 마지막 실패 시각을 남긴다(같은 잠금 중 재시도해도 값이 같다 = 멱등).
  const g = global?.results[0];
  if (g?.m && g.c >= GLOBAL_LIMIT.maxFailures) {
    await db
      .prepare(
        "INSERT INTO app_setting (key, value) VALUES ('last_global_lock_at', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(g.m)
      .run();
  }
  return Math.max(1, Math.ceil((untilMs - nowMs) / 1000));
}

/**
 * 서버 설정 오류로 PIN 을 대조하지 못한 시도는 '틀린 PIN' 이 아니므로 기록을 지운다(잠금 계산에서 제외).
 * ok=0 인 해당 행만 지운다.
 */
export async function voidAttempt(db: D1Database, attemptId: number): Promise<void> {
  await db.prepare("DELETE FROM auth_attempt WHERE rowid = ?1 AND ok = 0").bind(attemptId).run();
}

/** PIN 이 맞았을 때 해당 시도 행을 ok=1 로 바꾼다(실패 집계에서 빠진다). */
export async function markSuccess(db: D1Database, attemptId: number): Promise<void> {
  await db.prepare("UPDATE auth_attempt SET ok = 1 WHERE rowid = ?1").bind(attemptId).run();
}
