// 집 PC 워커 API (docs/05 "워커 API", docs/04 §3-2). 인증은 가드(Bearer 토큰)가 앞에서 하고, 여기서도 한 번 더 대조한다(이중 확인).
// 질문·답 본문은 로그·오류 메시지에 쓰지 않는다. 오류 응답은 일반화된 코드뿐이다.
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { touchWorkerSeen } from "../ask/seen";
import { LEASE_MS, MAX_ATTEMPTS, WORKER_ACTIVE, collectStrings } from "../ask/turns";
import { bearerMatches } from "../auth/worker";
import { errorResponse, jsonResponse } from "../http/errors";
import { SyncFinishSchema, SyncStartSchema } from "../../shared/sync-schema";
import {
  closeTurnLeftovers,
  pickTurnCandidate,
  registerWorkerTurnRoutes,
  turnClaimResponse,
} from "./worker-turn";
import { SYNC_RETENTION_MS } from "../lib/sync-state";
import { hasForbiddenWord } from "../../shared/ask-forbidden";
import {
  ASK_ANSWER_MAX_BYTES,
  ASK_HISTORY_DEFAULT_LIMIT,
  ASK_HISTORY_MAX_BYTES,
  ASK_HISTORY_MAX_LIMIT,
  AnswerSchema,
  HistoryItemSchema,
  type HistoryItem,
  WorkerAnswerSchema,
  WorkerFailSchema,
  WorkerProgressSchema,
  type Answer,
} from "../../shared/ask-schema";

export const workerRoutes = new Hono<AppEnv>();

export { LEASE_MS, MAX_ATTEMPTS };
const ID = /^[0-9]{1,9}$/;
const ACTIVE = WORKER_ACTIVE;

const iso = (ms: number): string => new Date(ms).toISOString();
const notFound = () => errorResponse(404, "not_found", "찾을 수 없어요.");
const conflict = () => errorResponse(409, "conflict", "지금 상태에서는 할 수 없어요.");

// 이중 확인: 가드를 지나왔더라도 토큰이 맞아야 한다(쿠키는 보지 않는다).
workerRoutes.use("/api/worker/*", async (c, next) => {
  if (!(await bearerMatches(c.req.raw, c.env))) {
    return errorResponse(401, "auth_required", "로그인이 필요해요.");
  }
  await next();
});

registerWorkerTurnRoutes(workerRoutes);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

workerRoutes.get("/api/worker/ping", async (c) => {
  await touchWorkerSeen(c.env.DB, c.get("deps").now());
  return new Response(null, { status: 204 });
});

/** 서버 환경변수 ASK_TURN_CLAIM: "0" 이면 claim 이 대화 턴을 고르지 않는다(질문만, 응답 모양도 이전과 같다). 그 밖은 켜짐. */
const turnClaimOn = (env: { ASK_TURN_CLAIM?: string }): boolean =>
  env.ASK_TURN_CLAIM?.trim() !== "0";

interface ClaimedQuestion {
  id: number;
  body: string;
  asked_by: string;
  created_at: string;
  red_flag: number;
  reask_count: number;
  reask_reason: string | null;
  reask_by: string | null;
}

const QUESTION_RETURNING =
  "RETURNING id, body, asked_by, created_at, red_flag, reask_count, reask_reason, reask_by";

/** 집은 질문으로 claim 응답을 만든다. 다시 답변(옛 방식으로 대기 중이던 질문)이면 직전 답과 이유를 함께 준다. */
async function questionClaimResponse(
  db: D1Database,
  claimed: ClaimedQuestion,
  withType: boolean,
): Promise<Response> {
  let reask: { count: number; reason: string; by: string; previousAnswer: unknown } | undefined;
  if (claimed.reask_count > 0) {
    const prev = await db
      .prepare(
        "SELECT answer_json FROM ask_answer_history WHERE question_id = ?1 ORDER BY version DESC LIMIT 1",
      )
      .bind(claimed.id)
      .first<{ answer_json: string }>();
    let previousAnswer: unknown = null;
    if (prev) {
      try {
        const p = AnswerSchema.safeParse(JSON.parse(prev.answer_json));
        if (p.success) previousAnswer = p.data;
      } catch {
        previousAnswer = null;
      }
    }
    reask = {
      count: claimed.reask_count,
      reason: claimed.reask_reason ?? "",
      by: claimed.reask_by ?? "",
      previousAnswer,
    };
  }
  return jsonResponse(200, {
    ...(withType ? { type: "question" } : {}),
    question: {
      id: claimed.id,
      body: claimed.body,
      askedBy: claimed.asked_by,
      createdAt: claimed.created_at,
      redFlag: claimed.red_flag === 1,
    },
    ...(reask ? { reask } : {}),
  });
}

workerRoutes.post("/api/worker/ask/claim", async (c) => {
  const db = c.env.DB;
  const nowMs = c.get("deps").now();
  const now = iso(nowMs);
  await touchWorkerSeen(db, nowMs);

  // 리스가 끝났는데 시도가 한도에 이른 질문은 실패로 닫는다.
  await db
    .prepare(
      `UPDATE ask_question SET status = 'failed', fail_code = 'too_many_attempts', lease_until = NULL, updated_at = ?1
       WHERE deleted_at IS NULL AND status IN ${ACTIVE} AND lease_until < ?1 AND attempts >= ?2`,
    )
    .bind(now, MAX_ATTEMPTS)
    .run();

  if (!turnClaimOn(c.env)) {
    // 턴을 고르지 않는 모양(T-Q5 이전과 같다): 한 문장으로 고르고 잡는다(원자적).
    const claimed = await db
      .prepare(
        `UPDATE ask_question
         SET status = 'claimed', claimed_at = ?1, lease_until = ?2, attempts = attempts + 1, updated_at = ?1
         WHERE id = (
           SELECT id FROM ask_question
           WHERE deleted_at IS NULL
             AND (status = 'pending' OR (status IN ${ACTIVE} AND lease_until < ?1))
             AND attempts < ?3
           ORDER BY red_flag DESC, created_at, id LIMIT 1)
         ${QUESTION_RETURNING}`,
      )
      .bind(now, iso(nowMs + LEASE_MS), MAX_ATTEMPTS)
      .first<ClaimedQuestion>();
    if (!claimed) return new Response(null, { status: 204 });
    return questionClaimResponse(db, claimed, false);
  }

  // 질문과 턴을 함께 본다: 두 표의 후보 1건씩을 골라 `red_flag DESC, created_at` 으로 겨루고, 이긴 쪽을 같은 대기 조건을
  // 다시 건 UPDATE 로 집는다. 0행이면(그사이 다른 claim 이 집음) 처음부터 1번 더 하고, 또 0행이면 204 다.
  await closeTurnLeftovers(db, now);
  for (let attempt = 0; attempt < 2; attempt++) {
    const q = await db
      .prepare(
        `SELECT id, red_flag, created_at FROM ask_question
         WHERE deleted_at IS NULL
           AND (status = 'pending' OR (status IN ${ACTIVE} AND lease_until < ?1))
           AND attempts < ?2
         ORDER BY red_flag DESC, created_at, id LIMIT 1`,
      )
      .bind(now, MAX_ATTEMPTS)
      .first<{ id: number; red_flag: number; created_at: string }>();
    const t = await pickTurnCandidate(db, now);
    if (!q && !t) return new Response(null, { status: 204 });
    // 같은 순위면 질문이 먼저다.
    const turnFirst =
      t !== null &&
      (q === null ||
        t.red_flag > q.red_flag ||
        (t.red_flag === q.red_flag && t.created_at < q.created_at));
    if (turnFirst) {
      const resp = await turnClaimResponse(db, t, nowMs);
      if (resp) return jsonResponse(200, resp);
      continue;
    }
    if (q) {
      const claimed = await db
        .prepare(
          `UPDATE ask_question
           SET status = 'claimed', claimed_at = ?1, lease_until = ?2, attempts = attempts + 1, updated_at = ?1
           WHERE id = ?4 AND deleted_at IS NULL
             AND (status = 'pending' OR (status IN ${ACTIVE} AND lease_until < ?1))
             AND attempts < ?3
           ${QUESTION_RETURNING}`,
        )
        .bind(now, iso(nowMs + LEASE_MS), MAX_ATTEMPTS, q.id)
        .first<ClaimedQuestion>();
      if (claimed) return questionClaimResponse(db, claimed, true);
    }
  }
  return new Response(null, { status: 204 });
});

// 워커 전용: 최근 끝난 질문과 가족 의견(표·메모). 본문이 들어 있으므로 Bearer 만(위 미들웨어), 로그에 내용을 쓰지 않는다. 크기 상한 200KB.
workerRoutes.get("/api/worker/ask/history", async (c) => {
  const raw = c.req.query("limit");
  let limit = ASK_HISTORY_DEFAULT_LIMIT;
  if (raw !== undefined) {
    if (!/^[0-9]{1,3}$/.test(raw)) return errorResponse(400, "bad_request", "잘못된 요청이에요.");
    limit = Number(raw);
    if (limit < 1 || limit > ASK_HISTORY_MAX_LIMIT) {
      return errorResponse(400, "bad_request", "잘못된 요청이에요.");
    }
  }
  const db = c.env.DB;
  const base = `SELECT q.id FROM ask_question q JOIN ask_answer a ON a.question_id = q.id
    WHERE q.deleted_at IS NULL AND q.status = 'done'
      AND json_valid(a.answer_json) AND json_extract(a.answer_json, '$.kind') = 'behavior'
    ORDER BY q.id DESC LIMIT ?1`;
  const qs = await db
    .prepare(
      `SELECT q.id, q.body, q.asked_by, q.created_at, a.level, a.answer_json
       FROM ask_question q JOIN ask_answer a ON a.question_id = q.id
       WHERE q.id IN (${base})
       ORDER BY q.id DESC`,
    )
    .bind(limit)
    .all<{
      id: number;
      body: string;
      asked_by: string;
      created_at: string;
      level: number;
      answer_json: string;
    }>();
  const votes = await db
    .prepare(
      `SELECT question_id, by, helpful, reason, updated_at FROM ask_vote WHERE question_id IN (${base}) ORDER BY updated_at`,
    )
    .bind(limit)
    .all<{
      question_id: number;
      by: string;
      helpful: number;
      reason: string | null;
      updated_at: string;
    }>();
  const notes = await db
    .prepare(
      `SELECT question_id, by, note, created_at FROM ask_feedback
       WHERE note IS NOT NULL AND question_id IN (${base}) ORDER BY id`,
    )
    .bind(limit)
    .all<{ question_id: number; by: string; note: string; created_at: string }>();

  const items: HistoryItem[] = [];
  for (const r of qs.results) {
    let parsed: ReturnType<typeof AnswerSchema.safeParse> | null;
    try {
      parsed = AnswerSchema.safeParse(JSON.parse(r.answer_json));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) continue;
    const item: HistoryItem = {
      id: r.id,
      body: r.body,
      askedBy: r.asked_by,
      createdAt: r.created_at,
      level: r.level,
      tryNowActions: parsed.data.tryNow.map((t) => t.action),
      votes: votes.results
        .filter((v) => v.question_id === r.id)
        .slice(0, 12)
        .map((v) => ({
          by: v.by,
          helpful: v.helpful === 1,
          reason: v.reason,
          updatedAt: v.updated_at,
        })),
      notes: notes.results
        .filter((n) => n.question_id === r.id)
        .slice(-10)
        .map((n) => ({ by: n.by, note: n.note, createdAt: n.created_at })),
    };
    items.push(HistoryItemSchema.parse(item));
  }
  // 크기 상한: 오래된 항목부터 버린다(목록은 최신순).
  const enc = new TextEncoder();
  while (
    items.length > 0 &&
    enc.encode(JSON.stringify({ items })).byteLength > ASK_HISTORY_MAX_BYTES
  ) {
    items.pop();
  }
  return jsonResponse(200, { items });
});

function idOf(raw: string): number | null {
  return ID.test(raw) ? Number(raw) : null;
}

workerRoutes.post("/api/worker/ask/:id/progress", async (c) => {
  const id = idOf(c.req.param("id"));
  if (id === null) return notFound();
  const parsed = WorkerProgressSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse(422, "validation_error", "입력을 확인해 주세요.");
  const nowMs = c.get("deps").now();
  const res = await c.env.DB.prepare(
    `UPDATE ask_question SET status = ?1, lease_until = ?2, updated_at = ?3
     WHERE id = ?4 AND deleted_at IS NULL AND status IN ${ACTIVE}`,
  )
    .bind(parsed.data.status, iso(nowMs + LEASE_MS), iso(nowMs), id)
    .run();
  if (res.meta.changes === 0) return conflict();
  return new Response(null, { status: 204 });
});

workerRoutes.post("/api/worker/ask/:id/answer", async (c) => {
  const id = idOf(c.req.param("id"));
  if (id === null) return notFound();
  const parsed = WorkerAnswerSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse(422, "validation_error", "입력을 확인해 주세요.");
  const { level, answer, reviewScore, model, workMs } = parsed.data;
  if (answer.level !== level) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.", {
      code: "level_mismatch",
    });
  }
  const json = JSON.stringify(answer satisfies Answer);
  if (new TextEncoder().encode(json).byteLength > ASK_ANSWER_MAX_BYTES) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.", { code: "too_large" });
  }
  const strings: string[] = [];
  collectStrings(answer, strings);
  if (strings.some(hasForbiddenWord)) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.", {
      code: "forbidden_word",
    });
  }

  const db = c.env.DB;
  const q = await db
    .prepare(
      `SELECT red_flag, created_at, claimed_at, reask_at FROM ask_question
       WHERE id = ?1 AND deleted_at IS NULL AND status IN ${ACTIVE}`,
    )
    .bind(id)
    .first<{
      red_flag: number;
      created_at: string;
      claimed_at: string | null;
      reask_at: string | null;
    }>();
  if (!q) return conflict();
  if (q.red_flag === 1 && level !== 10) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.", {
      code: "redflag_level",
    });
  }

  const nowMs = c.get("deps").now();
  // 다시 답변이면 다시 요청한 시각부터 센다.
  const created = Date.parse(q.reask_at ?? q.created_at);
  const claimedAt = q.claimed_at === null ? created : Date.parse(q.claimed_at);
  const waitMs = Math.max(0, claimedAt - created);
  const totalMs = Math.max(0, nowMs - created);
  const now = iso(nowMs);

  // 한 묶음(트랜잭션): 상태가 아직 진행 중일 때만 답을 넣고, 넣어졌을 때만 완료로 바꾼다.
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO ask_answer (question_id, level, answer_json, review_score, model, wait_ms, work_ms, total_ms, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
         WHERE EXISTS (SELECT 1 FROM ask_question WHERE id = ?1 AND deleted_at IS NULL AND status IN ${ACTIVE})`,
      )
      .bind(id, level, json, reviewScore, model, waitMs, workMs, totalMs, now),
    db
      .prepare(
        `UPDATE ask_question SET status = 'done', lease_until = NULL, fail_code = NULL, updated_at = ?2
         WHERE id = ?1 AND status IN ${ACTIVE} AND EXISTS (SELECT 1 FROM ask_answer WHERE question_id = ?1)`,
      )
      .bind(id, now),
  ]);
  if (insert?.meta.changes !== 1) return conflict();
  return jsonResponse(200, { status: "done", totalMs });
});

workerRoutes.post("/api/worker/ask/:id/fail", async (c) => {
  const id = idOf(c.req.param("id"));
  if (id === null) return notFound();
  const parsed = WorkerFailSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse(422, "validation_error", "입력을 확인해 주세요.");
  const db = c.env.DB;
  const res = await db
    .prepare(
      `UPDATE ask_question
       SET status = CASE WHEN attempts >= ?1 THEN 'failed' ELSE 'pending' END,
           fail_code = ?2, lease_until = NULL, updated_at = ?3
       WHERE id = ?4 AND deleted_at IS NULL AND status IN ${ACTIVE}`,
    )
    .bind(MAX_ATTEMPTS, parsed.data.code, iso(c.get("deps").now()), id)
    .run();
  if (res.meta.changes === 0) return conflict();
  const row = await db
    .prepare("SELECT status FROM ask_question WHERE id = ?1")
    .bind(id)
    .first<{ status: string }>();
  return jsonResponse(200, { status: row?.status ?? "failed" });
});

// 알림장 자동 업데이트 기록(T-S1). Bearer 만(위 미들웨어). 시작 때 90일 지난 행을 지운다.
// startedAt 은 집 PC 시계라 어긋날 수 있어 너무 먼 값은 거절한다(미래 10분, 과거 2일).
const START_SKEW_FUTURE_MS = 10 * 60_000;
const START_SKEW_PAST_MS = 2 * 24 * 60 * 60_000;

workerRoutes.post("/api/worker/sync/start", async (c) => {
  const parsed = SyncStartSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse(422, "validation_error", "입력을 확인해 주세요.");
  const nowMs = c.get("deps").now();
  const startedMs = Date.parse(parsed.data.startedAt);
  if (startedMs > nowMs + START_SKEW_FUTURE_MS || startedMs < nowMs - START_SKEW_PAST_MS) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.");
  }
  const db = c.env.DB;
  await db
    .prepare("DELETE FROM sync_run WHERE created_at < ?1")
    .bind(iso(nowMs - SYNC_RETENTION_MS))
    .run();
  const row = await db
    .prepare(
      "INSERT INTO sync_run (started_at, status, created_at) VALUES (?1, 'running', ?2) RETURNING id",
    )
    .bind(iso(startedMs), iso(nowMs))
    .first<{ id: number }>();
  if (!row) return errorResponse(500, "internal_error", "잠시 뒤 다시 해 주세요.");
  return jsonResponse(200, { id: row.id });
});

workerRoutes.post("/api/worker/sync/:id/finish", async (c) => {
  const id = idOf(c.req.param("id"));
  if (id === null) return notFound();
  const parsed = SyncFinishSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse(422, "validation_error", "입력을 확인해 주세요.");
  const v = parsed.data;
  const db = c.env.DB;
  // 진행 중인 행만 한 번 끝낼 수 있다(두 번째 보고는 409).
  const res = await db
    .prepare(
      `UPDATE sync_run
       SET status = ?1, stage = ?2, code = ?3, new_reports = ?4, new_comments = ?5, last_note_date = ?6, finished_at = ?7
       WHERE id = ?8 AND status = 'running'`,
    )
    .bind(
      v.status,
      v.stage ?? null,
      v.code ?? null,
      v.newReports ?? null,
      v.newComments ?? null,
      v.lastNoteDate ?? null,
      iso(c.get("deps").now()),
      id,
    )
    .run();
  if (res.meta.changes === 0) {
    const exists = await db
      .prepare("SELECT 1 AS x FROM sync_run WHERE id = ?1")
      .bind(id)
      .first<{ x: number }>();
    return exists ? conflict() : notFound();
  }
  return new Response(null, { status: 204 });
});
