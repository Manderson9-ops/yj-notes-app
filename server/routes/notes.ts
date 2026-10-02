// /api/notes (docs/05 알림장). 검색은 D1 LIKE(이스케이프)이고 FTS5 는 D-05 스파이크 뒤로 미룬다.
// 인증은 functions/_middleware.ts 가 앞단에서 강제한다.
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { errorResponse, jsonResponse } from "../http/errors";
import { buildHit } from "../../src/lib/noteHit";
import {
  DATE_RE,
  notesQuerySchema,
  type NoteComment,
  type NoteDay,
  type NoteListItem,
  type NoteReport,
} from "../../src/lib/notesSchemas";

export const noteRoutes = new Hono<AppEnv>();

interface DayRow {
  date: string;
  class_name: string;
  age_months: number;
  n_reports: number;
  n_comments: number;
  first_line: string;
}
interface TextRow {
  date: string;
  body: string;
}

/** LIKE 와일드카드(%, _)와 이스케이프 문자(\)를 글자 그대로 찾게 한다. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

noteRoutes.get("/api/notes", async (c) => {
  const parsed = notesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return errorResponse(400, "bad_request", "검색 조건이 올바르지 않아요.");
  const { q, from, to, class: className, cursor, limit } = parsed.data;
  const term = q ?? "";

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (from) {
    where.push("d.date >= ?");
    args.push(from);
  }
  if (to) {
    where.push("d.date <= ?");
    args.push(to);
  }
  if (className) {
    where.push("d.class_name = ?");
    args.push(className);
  }
  if (cursor) {
    where.push("d.date < ?");
    args.push(cursor);
  }
  if (term !== "") {
    const like = likePattern(term);
    where.push(
      `(EXISTS (SELECT 1 FROM note_item i WHERE i.date = d.date AND i.body LIKE ? ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM note_comment m JOIN note_item i2 ON i2.report_id = m.report_id
                   WHERE i2.date = d.date AND m.body LIKE ? ESCAPE '\\'))`,
    );
    args.push(like, like);
  }
  const sql = `SELECT d.date, d.class_name, d.age_months, d.n_reports, d.n_comments, d.first_line
    FROM note_day d ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY d.date DESC LIMIT ?`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...args, limit + 1)
    .all<DayRow>();

  const page = results.slice(0, limit);
  const nextCursor = results.length > limit ? (page[page.length - 1]?.date ?? null) : null;

  // 일치 발췌: 이 페이지의 날짜들만 본문·댓글을 읽는다(최대 50일).
  const hits = new Map<string, NoteListItem["hit"]>();
  if (term !== "" && page.length > 0) {
    const marks = page.map(() => "?").join(",");
    const dates = page.map((r) => r.date);
    const bodies = await c.env.DB.prepare(
      `SELECT date, body FROM note_item WHERE date IN (${marks}) ORDER BY posted_at`,
    )
      .bind(...dates)
      .all<TextRow>();
    const comments = await c.env.DB.prepare(
      `SELECT i.date AS date, m.body AS body FROM note_comment m
       JOIN note_item i ON i.report_id = m.report_id
       WHERE i.date IN (${marks}) ORDER BY m.posted_at`,
    )
      .bind(...dates)
      .all<TextRow>();
    for (const row of bodies.results) {
      if (hits.has(row.date)) continue;
      const hit = buildHit(row.body, term, "body");
      if (hit) hits.set(row.date, hit);
    }
    for (const row of comments.results) {
      if (hits.has(row.date)) continue;
      const hit = buildHit(row.body, term, "comment");
      if (hit) hits.set(row.date, hit);
    }
  }

  const items: NoteListItem[] = page.map((r) => {
    const hit = hits.get(r.date);
    return {
      date: r.date,
      class: r.class_name,
      ageMonths: r.age_months,
      nReports: r.n_reports,
      nComments: r.n_comments,
      firstLine: r.first_line,
      ...(hit ? { hit } : {}),
    };
  });
  return jsonResponse(200, { items, nextCursor });
});

noteRoutes.get("/api/notes/:date", async (c) => {
  const date = c.req.param("date");
  if (!DATE_RE.test(date)) return errorResponse(400, "bad_request", "날짜 형식이 올바르지 않아요.");
  const db = c.env.DB;
  const day = await db
    .prepare("SELECT date, class_name, age_months FROM note_day WHERE date = ?")
    .bind(date)
    .first<{ date: string; class_name: string; age_months: number }>();
  if (!day) return errorResponse(404, "not_found", "그날 알림장이 없어요.");

  const items = await db
    .prepare(
      `SELECT report_id, author_role, direction, weather, posted_at, body
       FROM note_item WHERE date = ? ORDER BY posted_at, report_id`,
    )
    .bind(date)
    .all<{
      report_id: number;
      author_role: string;
      direction: "to_home" | "to_center";
      weather: string | null;
      posted_at: string;
      body: string;
    }>();
  const comments = await db
    .prepare(
      `SELECT m.id, m.report_id, m.who, m.posted_at, m.body FROM note_comment m
       JOIN note_item i ON i.report_id = m.report_id
       WHERE i.date = ? ORDER BY m.posted_at, m.id`,
    )
    .bind(date)
    .all<{
      id: number;
      report_id: number;
      who: "parent" | "teacher";
      posted_at: string;
      body: string;
    }>();
  const prev = await db
    .prepare("SELECT MAX(date) AS d FROM note_day WHERE date < ?")
    .bind(date)
    .first<{ d: string | null }>();
  const next = await db
    .prepare("SELECT MIN(date) AS d FROM note_day WHERE date > ?")
    .bind(date)
    .first<{ d: string | null }>();

  const byReport = new Map<number, NoteComment[]>();
  for (const m of comments.results) {
    const list = byReport.get(m.report_id) ?? [];
    list.push({ id: m.id, who: m.who, postedAt: m.posted_at, body: m.body });
    byReport.set(m.report_id, list);
  }
  const reports: NoteReport[] = items.results.map((i) => ({
    reportId: i.report_id,
    authorRole: i.author_role,
    direction: i.direction,
    weather: i.weather,
    postedAt: i.posted_at,
    body: i.body,
    comments: byReport.get(i.report_id) ?? [],
  }));
  const body: NoteDay = {
    date: day.date,
    class: day.class_name,
    ageMonths: day.age_months,
    items: reports,
    prev: prev?.d ?? null,
    next: next?.d ?? null,
  };
  return jsonResponse(200, body);
});
