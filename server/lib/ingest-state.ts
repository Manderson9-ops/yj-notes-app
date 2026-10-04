// 적재(ingest_run) 상태 판정 (R1-6). 관리 PC 가 upload 중이면 화면이 잠시 비거나 섞여 보일 수 있어 알려 준다.
// 가장 최근 실행이 'running' 이면 갱신 중, 'failed' 이면 마지막 갱신 실패(그 뒤 성공 실행이 없는 상태와 같다).
// 'running' 이 오래(STALE_RUNNING_MS) 지속되면 중단된 것으로 보고 failed 로 취급한다(영구 배너 방지).
export type IngestState = "idle" | "running" | "failed";

export const STALE_RUNNING_MS = 6 * 60 * 60_000;

export async function readIngestState(db: D1Database, nowMs: number): Promise<IngestState> {
  const row = await db
    .prepare("SELECT status, started_at FROM ingest_run ORDER BY id DESC LIMIT 1")
    .first<{ status: "running" | "ok" | "failed"; started_at: string }>();
  if (!row || row.status === "ok") return "idle";
  if (row.status === "failed") return "failed";
  const started = Date.parse(row.started_at);
  return Number.isFinite(started) && nowMs - started > STALE_RUNNING_MS ? "failed" : "running";
}
