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
  AskReaskSchema,
  AskVoteSchema,
  ASK_REASK_MAX,
  ASK_VOTERS_MAX,
  joinReaskReason,
  type AskStatus,
} from "../../shared/ask-schema";

export const askRoutes = new Hono<AppEnv>();

/** 1인 연속 남용 방지: 10분 안 10건이면 다음은 429. */
export const ASK_RATE = { max: 10, windowMs: 10 * 60_000 } as const;
export const FEEDBACK_MAX_PER_QUESTION = 50;
const LIST_LIMIT = 20;
/** 표 수(목록·요약용): 도움 됐어요(1)/안 됐어요(0). 상수만 끼워 넣는다(사용자 입력 아님). */
const VOTE_COUNT = (v: 0 | 1): string =>
  `(SELECT COUNT(*) FROM ask_vote v WHERE v.question_id = q.id AND v.helpful = ${String(v)})`;
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
const conflict = () => errorResponse(409, "conflict", "지금 상태에서는 할 수 없어요.");
const badRequest = () => errorResponse(400, "bad_request", "잘못된 요청이에요.");

interface QuestionRow {
  id: number;
  asked_by: string;
  body: string;
  status: AskStatus;
  red_flag: number;
  created_at: string;
  reask_count: number;
  reask_reason: string | null;
  reask_by: string | null;
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
            q.created_at, ${VOTE_COUNT(1)} AS up, ${VOTE_COUNT(0)} AS down,
            CASE WHEN a.answer_json IS NOT NULL AND json_valid(a.answer_json)
                 THEN CASE WHEN json_extract(a.answer_json, '$.kind') = 'not_behavior' THEN NULL ELSE a.level END
                 ELSE a.level END AS level
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
      up: number;
      down: number;
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
      votes: { up: r.up, down: r.down },
    })),
    nextBefore: results.length > LIST_LIMIT ? (page[page.length - 1]?.id ?? null) : null,
  });
});

async function loadQuestion(db: D1Database, id: number): Promise<QuestionRow | null> {
  return db
    .prepare(
      `SELECT id, asked_by, body, status, red_flag, created_at, reask_count, reask_reason, reask_by
       FROM ask_question WHERE id = ?1 AND deleted_at IS NULL`,
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
    /** 행동 질문이 아닌 답(not_behavior)은 DB 에는 1로 있지만 API 는 null 로 숨긴다. */
    level: number | null;
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
        level: parsed.data.kind === "not_behavior" ? null : ans.level,
        answer: parsed.data,
        createdAt: ans.created_at,
        totalMs: ans.total_ms,
        reviewScore: ans.review_score,
      };
    }
  }
  // 메모(해 봤어요)만. 도움 여부는 votes 로 간다.
  const fb = await db
    .prepare(
      "SELECT id, by, note, created_at FROM ask_feedback WHERE question_id = ?1 AND note IS NOT NULL ORDER BY id",
    )
    .bind(id)
    .all<{ id: number; by: string; note: string; created_at: string }>();
  const votes = await db
    .prepare(
      "SELECT by, helpful, reason, updated_at FROM ask_vote WHERE question_id = ?1 ORDER BY updated_at, by",
    )
    .bind(id)
    .all<{ by: string; helpful: number; reason: string | null; updated_at: string }>();
  const hist = await db
    .prepare(
      "SELECT version, level, answer_json, created_at FROM ask_answer_history WHERE question_id = ?1 ORDER BY version",
    )
    .bind(id)
    .all<{ version: number; level: number; answer_json: string; created_at: string }>();
  const history: { version: number; level: number | null; createdAt: string; answer: unknown }[] =
    [];
  for (const h of hist.results) {
    let parsed: ReturnType<typeof AnswerSchema.safeParse> | null;
    try {
      parsed = AnswerSchema.safeParse(JSON.parse(h.answer_json));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) continue;
    history.push({
      version: h.version,
      level: parsed.data.kind === "not_behavior" ? null : h.level,
      createdAt: h.created_at,
      answer: parsed.data,
    });
  }
  return jsonResponse(200, {
    question: { id: q.id, askedBy: q.asked_by, body: q.body, createdAt: q.created_at },
    status: q.status,
    redFlag: q.red_flag === 1,
    ...(answer ? { answer } : {}),
    feedback: fb.results.map((f) => ({
      id: f.id,
      by: f.by,
      note: f.note,
      createdAt: f.created_at,
    })),
    votes: votes.results.map((v) => ({
      by: v.by,
      helpful: v.helpful === 1,
      reason: v.reason,
      updatedAt: v.updated_at,
    })),
    history,
    reask: { count: q.reask_count, reason: q.reask_reason, by: q.reask_by },
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
  const { by, note } = parsed.data;
  const ins = await db
    .prepare(
      "INSERT INTO ask_feedback (question_id, by, helpful, note, created_at) VALUES (?1, ?2, NULL, ?3, ?4)",
    )
    .bind(id, by, note, iso(c.get("deps").now()))
    .run();
  return jsonResponse(201, { id: ins.meta.last_row_id });
});

// 표: 사람당 질문당 한 표. helpful null 이면 취소. 바꾸기는 같은 호출로(upsert).
askRoutes.put("/api/ask/:id/vote", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const body = await readBody(c.req.raw);
  if (body === undefined) return badRequest();
  const parsed = AskVoteSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const db = c.env.DB;
  const q = await loadQuestion(db, id);
  if (!q) return notFound();
  if (q.status !== "done") return conflict();
  const { by, helpful, reason } = parsed.data;
  if (helpful === null) {
    await db.prepare("DELETE FROM ask_vote WHERE question_id = ?1 AND by = ?2").bind(id, by).run();
  } else {
    // 서로 다른 사람 수 상한: 이미 표가 있는 사람은 바꾸기라 통과한다.
    const cnt = await db
      .prepare(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN by = ?2 THEN 1 ELSE 0 END) AS mine
         FROM ask_vote WHERE question_id = ?1`,
      )
      .bind(id, by)
      .first<{ n: number; mine: number | null }>();
    if ((cnt?.mine ?? 0) === 0 && (cnt?.n ?? 0) >= ASK_VOTERS_MAX) {
      return errorResponse(429, "too_many", "의견을 너무 많이 남겼어요.");
    }
    await db
      .prepare(
        `INSERT INTO ask_vote (question_id, by, helpful, reason, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (question_id, by) DO UPDATE SET helpful = excluded.helpful, reason = excluded.reason, updated_at = excluded.updated_at`,
      )
      .bind(id, by, helpful ? 1 : 0, helpful ? null : (reason ?? null), iso(c.get("deps").now()))
      .run();
  }
  const votes = await db
    .prepare(
      "SELECT by, helpful, reason, updated_at FROM ask_vote WHERE question_id = ?1 ORDER BY updated_at, by",
    )
    .bind(id)
    .all<{ by: string; helpful: number; reason: string | null; updated_at: string }>();
  return jsonResponse(200, {
    votes: votes.results.map((v) => ({
      by: v.by,
      helpful: v.helpful === 1,
      reason: v.reason,
      updatedAt: v.updated_at,
    })),
  });
});

// 다시 답변: 현재 답을 이력으로 옮기고 대기로 되돌린다(질문당 최대 3회). 한 묶음(트랜잭션)이라 동시 요청에도 한 번만 먹는다.
askRoutes.post("/api/ask/:id/reask", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const body = await readBody(c.req.raw);
  if (body === undefined) return badRequest();
  const parsed = AskReaskSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const db = c.env.DB;
  const q = await loadQuestion(db, id);
  if (!q) return notFound();
  if (q.status !== "done") return conflict();
  if (q.reask_count >= ASK_REASK_MAX) {
    return errorResponse(429, "too_many", "다시 답변은 세 번까지 받을 수 있어요.");
  }
  const { by, choice, text } = parsed.data;
  const reason = joinReaskReason(choice, text);
  const now = iso(c.get("deps").now());
  const [moved, bumped] = await db.batch([
    db
      .prepare(
        `INSERT INTO ask_answer_history (question_id, version, level, answer_json, review_score, model, total_ms, created_at)
         SELECT a.question_id,
                (SELECT COALESCE(MAX(h.version), 0) + 1 FROM ask_answer_history h WHERE h.question_id = a.question_id),
                a.level, a.answer_json, a.review_score, a.model, a.total_ms, a.created_at
         FROM ask_answer a JOIN ask_question q ON q.id = a.question_id
         WHERE q.id = ?1 AND q.deleted_at IS NULL AND q.status = 'done' AND q.reask_count < ?2`,
      )
      .bind(id, ASK_REASK_MAX),
    db
      .prepare(
        `UPDATE ask_question
         SET status = 'pending', attempts = 0, claimed_at = NULL, lease_until = NULL, fail_code = NULL,
             reask_count = reask_count + 1, reask_reason = ?3, reask_by = ?4, reask_at = ?5, updated_at = ?5
         WHERE id = ?1 AND deleted_at IS NULL AND status = 'done' AND reask_count < ?2
           AND EXISTS (SELECT 1 FROM ask_answer WHERE question_id = ?1)`,
      )
      .bind(id, ASK_REASK_MAX, reason, by, now),
    // 이력으로 옮겨진 뒤에만 현재 답을 지운다(대기 중인 질문에는 현재 답이 없다).
    db
      .prepare(
        `DELETE FROM ask_answer WHERE question_id = ?1
           AND EXISTS (SELECT 1 FROM ask_question WHERE id = ?1 AND status = 'pending' AND reask_at = ?2)`,
      )
      .bind(id, now),
  ]);
  if (moved?.meta.changes !== 1 || bumped?.meta.changes !== 1) return conflict();
  return jsonResponse(200, { status: "pending", reaskCount: q.reask_count + 1 });
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
