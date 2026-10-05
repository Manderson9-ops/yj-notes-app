// 집 PC 워커 API (docs/05 "워커 API", docs/04 §3-2). 인증은 가드(Bearer 토큰)가 앞에서 하고, 여기서도 한 번 더 대조한다(이중 확인).
// 질문·답 본문은 로그·오류 메시지에 쓰지 않는다. 오류 응답은 일반화된 코드뿐이다.
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { touchWorkerSeen } from "../ask/seen";
import { bearerMatches } from "../auth/worker";
import { errorResponse, jsonResponse } from "../http/errors";
import { hasForbiddenWord } from "../../shared/ask-levels";
import {
  ASK_ANSWER_MAX_BYTES,
  WorkerAnswerSchema,
  WorkerFailSchema,
  WorkerProgressSchema,
  type Answer,
} from "../../shared/ask-schema";

export const workerRoutes = new Hono<AppEnv>();

export const LEASE_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
const ID = /^[0-9]{1,9}$/;
const ACTIVE = "('claimed','answering','reviewing')";

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

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (typeof v === "object" && v !== null)
    for (const x of Object.values(v)) collectStrings(x, out);
}

workerRoutes.get("/api/worker/ping", async (c) => {
  await touchWorkerSeen(c.env.DB, c.get("deps").now());
  return new Response(null, { status: 204 });
});

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

  // 한 문장으로 고르고 잡는다(원자적): 두 워커가 동시에 불러도 한 건은 한 번만 잡힌다.
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
       RETURNING id, body, asked_by, created_at, red_flag`,
    )
    .bind(now, iso(nowMs + LEASE_MS), MAX_ATTEMPTS)
    .first<{ id: number; body: string; asked_by: string; created_at: string; red_flag: number }>();
  if (!claimed) return new Response(null, { status: 204 });
  return jsonResponse(200, {
    question: {
      id: claimed.id,
      body: claimed.body,
      askedBy: claimed.asked_by,
      createdAt: claimed.created_at,
      redFlag: claimed.red_flag === 1,
    },
  });
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
      `SELECT red_flag, created_at, claimed_at FROM ask_question
       WHERE id = ?1 AND deleted_at IS NULL AND status IN ${ACTIVE}`,
    )
    .bind(id)
    .first<{ red_flag: number; created_at: string; claimed_at: string | null }>();
  if (!q) return conflict();
  if (q.red_flag === 1 && level !== 10) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.", {
      code: "redflag_level",
    });
  }

  const nowMs = c.get("deps").now();
  const created = Date.parse(q.created_at);
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
