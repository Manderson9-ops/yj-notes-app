// GET /api/overview (docs/05 대시보드). 모든 숫자는 쿼리 값(P3). 자료가 없으면 0/빈 배열이다(오류 아님).
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { jsonResponse } from "../http/errors";
import { previewOfDay } from "../../src/lib/notePreview";
import type { Overview } from "../../src/lib/notesSchemas";

export const overviewRoutes = new Hono<AppEnv>();

overviewRoutes.get("/api/overview", async (c) => {
  const db = c.env.DB;
  const days = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last,
              COALESCE(SUM(n_reports), 0) AS reports, COALESCE(SUM(n_comments), 0) AS comments
       FROM note_day`,
    )
    .first<{
      n: number;
      first: string | null;
      last: string | null;
      reports: number;
      comments: number;
    }>();
  const ingest = await db
    .prepare(
      `SELECT COALESCE(finished_at, started_at) AS at, status, source_commit
       FROM ingest_run WHERE status = 'ok' ORDER BY id DESC LIMIT 1`,
    )
    .first<{ at: string; status: "ok"; source_commit: string }>();
  const observed = await db
    .prepare("SELECT COUNT(DISTINCT evidence_id) AS n FROM observation")
    .first<{ n: number }>();
  const total = await db.prepare("SELECT COUNT(*) AS n FROM milestone").first<{ n: number }>();
  const recentNotes = await db
    .prepare(
      `SELECT date, age_months, first_line, n_comments FROM note_day ORDER BY date DESC LIMIT 3`,
    )
    .all<{ date: string; age_months: number; first_line: string; n_comments: number }>();
  const recentDates = recentNotes.results.map((r) => r.date);
  const recentItems = recentDates.length
    ? await db
        .prepare(
          `SELECT date, direction, body FROM note_item
           WHERE date IN (${recentDates.map(() => "?").join(",")}) ORDER BY posted_at`,
        )
        .bind(...recentDates)
        .all<{ date: string; direction: string; body: string }>()
    : { results: [] };
  const recentLogs = await db
    .prepare(
      `SELECT l.id, l.type, COALESCE(t.label_ko, l.type) AS type_label, l.occurred_on, l.recorder, l.note
       FROM family_log l LEFT JOIN log_type t ON t.code = l.type
       WHERE l.deleted_at IS NULL
       ORDER BY l.occurred_on DESC, l.created_at DESC LIMIT 5`,
    )
    .all<{
      id: string;
      type: string;
      type_label: string;
      occurred_on: string;
      recorder: string;
      note: string | null;
    }>();

  // R1-3: 마지막 전체 잠금 시각(없으면 null). 로그인한 사용자에게만 보인다(이 라우트는 세션 필요).
  const lock = await db
    .prepare("SELECT value FROM app_setting WHERE key = 'last_global_lock_at'")
    .first<{ value: string }>();

  const observedN = observed?.n ?? 0;
  const body: Overview = {
    noteDays: days?.n ?? 0,
    reports: days?.reports ?? 0,
    comments: days?.comments ?? 0,
    range: days?.first && days.last ? { from: days.first, to: days.last } : null,
    security: { lastGlobalLockAt: lock?.value ?? null },
    lastIngest: ingest
      ? { at: ingest.at, status: ingest.status, commit: ingest.source_commit }
      : null,
    milestones: { observed: observedN, unobserved: Math.max(0, (total?.n ?? 0) - observedN) },
    recentNotes: recentNotes.results.map((r) => ({
      date: r.date,
      ageMonths: r.age_months,
      firstLine: previewOfDay(
        recentItems.results.filter((i) => i.date === r.date),
        r.first_line,
      ),
      nComments: r.n_comments,
    })),
    recentLogs: recentLogs.results.map((r) => ({
      id: r.id,
      type: r.type,
      typeLabel: r.type_label,
      occurredOn: r.occurred_on,
      recorder: r.recorder,
      note: r.note,
    })),
  };
  return jsonResponse(200, body);
});
