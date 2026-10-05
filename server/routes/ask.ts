// 물어보기 세션 API (docs/05 "물어보기"). 가족 누구나(세션 필요: 가드가 강제). 질문·답 본문은 로그·오류에 쓰지 않는다.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { instantResults } from "../ask/instant";
import { detectRedFlag } from "../ask/redflags";
import { errorResponse, jsonResponse } from "../http/errors";
import {
  AnswerSchema,
  AskCreateSchema,
  AskFeedbackSchema,
  type AskStatus,
} from "../../shared/ask-schema";

export const askRoutes = new Hono<AppEnv>();

/** 1인 연속 남용 방지: 10분 안 10건이면 다음은 429. */
export const ASK_RATE = { max: 10, windowMs: 10 * 60_000 } as const;
export const FEEDBACK_MAX_PER_QUESTION = 50;
const LIST_LIMIT = 20;
const ID = /^[0-9]{1,9}$/;

const iso = (ms: number): string => new Date(ms).toISOString();
const notFound = () => errorResponse(404, "not_found", "찾을 수 없어요.");

function parseId(raw: string): number | null {
  return ID.test(raw) ? Number(raw) : null;
}

async function readBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

const invalid = () => errorResponse(422, "validation_error", "입력을 확인해 주세요.");
const badRequest = () => errorResponse(400, "bad_request", "잘못된 요청이에요.");

interface QuestionRow {
  id: number;
  asked_by: string;
  body: string;
  status: AskStatus;
  red_flag: number;
  created_at: string;
}

askRoutes.post("/api/ask", async (c) => {
  const body = await readBody(c.req.raw);
  if (body === undefined) return badRequest();
  const parsed = AskCreateSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const { body: text, askedBy } = parsed.data;
  const db = c.env.DB;
  const nowMs = c.get("deps").now();
  const nowIso = iso(nowMs);

  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM ask_question WHERE asked_by = ?1 AND created_at > ?2")
    .bind(askedBy, iso(nowMs - ASK_RATE.windowMs))
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= ASK_RATE.max) {
    return errorResponse(429, "too_many", "질문을 너무 많이 보냈어요. 잠시 뒤에 다시 해 주세요.");
  }

  const red = detectRedFlag(text).redFlag ? 1 : 0;
  const ins = await db
    .prepare(
      `INSERT INTO ask_question (asked_by, body, status, red_flag, created_at, updated_at)
       VALUES (?1, ?2, 'pending', ?3, ?4, ?4)`,
    )
    .bind(askedBy, text, red, nowIso)
    .run();
  const instant = await instantResults(db, text);
  return jsonResponse(201, {
    id: ins.meta.last_row_id,
    status: "pending",
    redFlag: red === 1,
    instant,
  });
});

const beforeSchema = z.coerce.number().int().min(1).max(2_000_000_000);

askRoutes.get("/api/ask", async (c) => {
  const raw = c.req.query("before");
  let before: number | null = null;
  if (raw !== undefined && raw !== "") {
    const p = beforeSchema.safeParse(raw);
    if (!p.success) return badRequest();
    before = p.data;
  }
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.asked_by, substr(q.body, 1, 80) AS preview, length(q.body) AS len, q.status, q.red_flag,
            q.created_at, a.level
     FROM ask_question q LEFT JOIN ask_answer a ON a.question_id = q.id
     WHERE q.deleted_at IS NULL AND (?1 IS NULL OR q.id < ?1)
     ORDER BY q.id DESC LIMIT ?2`,
  )
    .bind(before, LIST_LIMIT + 1)
    .all<{
      id: number;
      asked_by: string;
      preview: string;
      len: number;
      status: AskStatus;
      red_flag: number;
      created_at: string;
      level: number | null;
    }>();
  const page = results.slice(0, LIST_LIMIT);
  return jsonResponse(200, {
    items: page.map((r) => ({
      id: r.id,
      askedBy: r.asked_by,
      bodyPreview: r.len > 80 ? `${r.preview}…` : r.preview,
      status: r.status,
      redFlag: r.red_flag === 1,
      ...(r.level === null ? {} : { level: r.level }),
      createdAt: r.created_at,
    })),
    nextBefore: results.length > LIST_LIMIT ? (page[page.length - 1]?.id ?? null) : null,
  });
});

async function loadQuestion(db: D1Database, id: number): Promise<QuestionRow | null> {
  return db
    .prepare(
      "SELECT id, asked_by, body, status, red_flag, created_at FROM ask_question WHERE id = ?1 AND deleted_at IS NULL",
    )
    .bind(id)
    .first<QuestionRow>();
}

askRoutes.get("/api/ask/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const db = c.env.DB;
  const q = await loadQuestion(db, id);
  if (!q) return notFound();
  const ans = await db
    .prepare(
      "SELECT level, answer_json, total_ms, review_score, created_at FROM ask_answer WHERE question_id = ?1",
    )
    .bind(id)
    .first<{
      level: number;
      answer_json: string;
      total_ms: number | null;
      review_score: number | null;
      created_at: string;
    }>();
  let answer: {
    level: number;
    answer: unknown;
    createdAt: string;
    totalMs: number | null;
    reviewScore: number | null;
  } | null = null;
  if (ans) {
    let parsed: ReturnType<typeof AnswerSchema.safeParse> | null;
    try {
      parsed = AnswerSchema.safeParse(JSON.parse(ans.answer_json));
    } catch {
      parsed = null;
    }
    if (parsed?.success) {
      answer = {
        level: ans.level,
        answer: parsed.data,
        createdAt: ans.created_at,
        totalMs: ans.total_ms,
        reviewScore: ans.review_score,
      };
    }
  }
  const fb = await db
    .prepare(
      "SELECT id, by, helpful, note, created_at FROM ask_feedback WHERE question_id = ?1 ORDER BY id",
    )
    .bind(id)
    .all<{
      id: number;
      by: string;
      helpful: number | null;
      note: string | null;
      created_at: string;
    }>();
  return jsonResponse(200, {
    question: { id: q.id, askedBy: q.asked_by, body: q.body, createdAt: q.created_at },
    status: q.status,
    redFlag: q.red_flag === 1,
    ...(answer ? { answer } : {}),
    feedback: fb.results.map((f) => ({
      id: f.id,
      by: f.by,
      helpful: f.helpful === null ? null : f.helpful === 1,
      note: f.note,
      createdAt: f.created_at,
    })),
  });
});

// 즉시 결과를 질문 번호로 다시 보여 준다(목록에서 열었을 때). 폴링에는 쓰지 않는다.
askRoutes.get("/api/ask/:id/instant", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const q = await loadQuestion(c.env.DB, id);
  if (!q) return notFound();
  return jsonResponse(200, await instantResults(c.env.DB, q.body));
});

askRoutes.post("/api/ask/:id/feedback", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const body = await readBody(c.req.raw);
  if (body === undefined) return badRequest();
  const parsed = AskFeedbackSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const db = c.env.DB;
  if (!(await loadQuestion(db, id))) return notFound();
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM ask_feedback WHERE question_id = ?1")
    .bind(id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= FEEDBACK_MAX_PER_QUESTION) {
    return errorResponse(429, "too_many", "의견을 너무 많이 남겼어요.");
  }
  const { by, helpful, note } = parsed.data;
  const ins = await db
    .prepare(
      "INSERT INTO ask_feedback (question_id, by, helpful, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(
      id,
      by,
      helpful === undefined || helpful === null ? null : helpful ? 1 : 0,
      note ?? null,
      iso(c.get("deps").now()),
    )
    .run();
  return jsonResponse(201, { id: ins.meta.last_row_id });
});

askRoutes.delete("/api/ask/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const nowIso = iso(c.get("deps").now());
  const res = await c.env.DB.prepare(
    "UPDATE ask_question SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
  )
    .bind(nowIso, id)
    .run();
  if (res.meta.changes === 0) return notFound();
  return new Response(null, { status: 204 });
});
