// 집 PC 워커 API — 대화 턴(T-Q5). claim 에 턴을 합치는 함수와 턴 진행·짧은 답·카드·실패 라우트.
// 인증(Bearer)은 worker.ts 의 미들웨어가 앞에서 한다(이 라우트들은 그 뒤에 등록된다).
// 질문·답·대화 본문은 로그·오류 메시지에 쓰지 않는다.
import type { Hono } from "hono";
import type { AppEnv } from "../app";
import { touchWorkerSeen } from "../ask/seen";
import {
  LEASE_MS,
  MAX_ATTEMPTS,
  WORKER_ACTIVE,
  collectStrings,
  parseCard,
  parseFollowup,
} from "../ask/turns";
import { errorResponse, jsonResponse } from "../http/errors";
import { hasForbiddenWord } from "../../shared/ask-forbidden";
import {
  ASK_ANSWER_MAX_BYTES,
  ASK_REASK_MAX,
  ASK_THREAD_TURNS,
  TurnFailSchema,
  TurnProgressSchema,
  TurnReplySchema,
  WorkerAnswerSchema,
  type Answer,
  type AskTurnKind,
  type ClaimTurnResponse,
} from "../../shared/ask-schema";

const ID = /^[0-9]{1,9}$/;
const iso = (ms: number): string => new Date(ms).toISOString();
const idOf = (raw: string): number | null => (ID.test(raw) ? Number(raw) : null);
const notFound = () => errorResponse(404, "not_found", "찾을 수 없어요.");
const conflict = () => errorResponse(409, "conflict", "지금 상태에서는 할 수 없어요.");
const invalid = (code?: string) =>
  errorResponse(422, "validation_error", "입력을 확인해 주세요.", code ? { code } : undefined);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** ask_turn 의 짧은 답 JSON 상한(마이그레이션 CHECK 와 같다). */
const REPLY_JSON_MAX = 8192;

// ───────────────────────── claim 쪽 ─────────────────────────

/**
 * claim 앞의 정리 세 가지(한 묶음): ① 잠긴 질문의 일반 턴 카드 대기를 `redlock` 으로 닫는다(먼저 — 카드를 만들 이유가
 * 없어진 행이 실패로 보이지 않게) ② 카드 시도 3번이 끝난 턴을 `failed` ③ 짧은 답 시도 3번이 끝난 턴을 `failed`.
 */
export async function closeTurnLeftovers(db: D1Database, nowIso: string): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE ask_turn SET card_status = 'none', card_note = 'redlock', updated_at = ?1
         WHERE deleted_at IS NULL AND card_status = 'pending' AND red_flag = 0
           AND EXISTS (SELECT 1 FROM ask_question q WHERE q.id = ask_turn.question_id AND (q.red_lock = 1 OR q.red_flag = 1))`,
      )
      .bind(nowIso),
    db
      .prepare(
        `UPDATE ask_turn SET card_status = 'failed', card_fail_code = 'too_many_attempts', card_lease_until = NULL, updated_at = ?1
         WHERE deleted_at IS NULL AND status = 'done' AND card_status = 'pending' AND card_attempts >= ?2
           AND (card_lease_until IS NULL OR card_lease_until < ?1)`,
      )
      .bind(nowIso, MAX_ATTEMPTS),
    db
      .prepare(
        `UPDATE ask_turn SET status = 'failed', fail_code = 'too_many_attempts', lease_until = NULL, updated_at = ?1
         WHERE deleted_at IS NULL AND status IN ${WORKER_ACTIVE} AND lease_until < ?1 AND attempts >= ?2`,
      )
      .bind(nowIso, MAX_ATTEMPTS),
  ]);
}

export interface TurnCandidate {
  id: number;
  red_flag: number;
  created_at: string;
  stage: "reply" | "card";
}

/** 집을 수 있는 턴 1건(짧은 답 단계 술어 OR 카드 단계 술어). 정렬 `red_flag DESC, created_at, id`. */
export async function pickTurnCandidate(
  db: D1Database,
  nowIso: string,
): Promise<TurnCandidate | null> {
  return db
    .prepare(
      `SELECT t.id, t.red_flag, t.created_at, CASE WHEN t.status = 'done' THEN 'card' ELSE 'reply' END AS stage
       FROM ask_turn t JOIN ask_question q ON q.id = t.question_id
       WHERE t.deleted_at IS NULL AND q.deleted_at IS NULL
         AND (
           ((t.status = 'pending' OR (t.status IN ${WORKER_ACTIVE} AND t.lease_until < ?1)) AND t.attempts < ?2)
           OR (t.status = 'done' AND t.card_status = 'pending' AND t.card_attempts < ?2
               AND (t.card_lease_until IS NULL OR t.card_lease_until < ?1)
               AND ((q.red_lock = 0 AND q.red_flag = 0) OR t.red_flag = 1))
         )
       ORDER BY t.red_flag DESC, t.created_at, t.id LIMIT 1`,
    )
    .bind(nowIso, MAX_ATTEMPTS)
    .first<TurnCandidate>();
}

interface TurnRow {
  id: number;
  question_id: number;
  seq: number;
  kind: AskTurnKind;
  asked_by: string;
  body: string;
  reask_reason: string | null;
  red_flag: number;
  reply_json: string | null;
  card_reason: string | null;
}

const TURN_RETURNING =
  "RETURNING id, question_id, seq, kind, asked_by, body, reask_reason, red_flag, reply_json, card_reason";

/** 후보를 같은 대기 조건을 다시 건 UPDATE 로 집는다. 0행이면 그사이 다른 claim 이 집은 것이다. */
async function grabTurn(
  db: D1Database,
  cand: TurnCandidate,
  nowMs: number,
): Promise<TurnRow | null> {
  const now = iso(nowMs);
  const lease = iso(nowMs + LEASE_MS);
  if (cand.stage === "reply") {
    return db
      .prepare(
        `UPDATE ask_turn
         SET status = 'claimed', claimed_at = ?1, lease_until = ?2, attempts = attempts + 1, updated_at = ?1
         WHERE id = ?4 AND deleted_at IS NULL
           AND (status = 'pending' OR (status IN ${WORKER_ACTIVE} AND lease_until < ?1)) AND attempts < ?3
           AND EXISTS (SELECT 1 FROM ask_question p WHERE p.id = ask_turn.question_id AND p.deleted_at IS NULL)
         ${TURN_RETURNING}`,
      )
      .bind(now, lease, MAX_ATTEMPTS, cand.id)
      .first<TurnRow>();
  }
  return db
    .prepare(
      `UPDATE ask_turn
       SET card_lease_until = ?2, card_attempts = card_attempts + 1, updated_at = ?1
       WHERE id = ?4 AND deleted_at IS NULL AND status = 'done' AND card_status = 'pending'
         AND card_attempts < ?3 AND (card_lease_until IS NULL OR card_lease_until < ?1)
         AND EXISTS (SELECT 1 FROM ask_question p WHERE p.id = ask_turn.question_id AND p.deleted_at IS NULL
                       AND ((p.red_lock = 0 AND p.red_flag = 0) OR ask_turn.red_flag = 1))
       ${TURN_RETURNING}`,
    )
    .bind(now, lease, MAX_ATTEMPTS, cand.id)
    .first<TurnRow>();
}

/** 집은 턴으로 claim 응답(대화 맥락 thread 포함)을 만든다. thread 는 claim UPDATE 뒤에 읽는다. */
export async function turnClaimResponse(
  db: D1Database,
  cand: TurnCandidate,
  nowMs: number,
): Promise<ClaimTurnResponse | null> {
  const t = await grabTurn(db, cand, nowMs);
  if (!t) return null;
  const q = await db
    .prepare(
      `SELECT id, body, asked_by, created_at, red_flag, red_lock, reask_count, card_updates
       FROM ask_question WHERE id = ?1`,
    )
    .bind(t.question_id)
    .first<{
      id: number;
      body: string;
      asked_by: string;
      created_at: string;
      red_flag: number;
      red_lock: number;
      reask_count: number;
      card_updates: number;
    }>();
  if (!q) return null;
  const cardRow = await db
    .prepare("SELECT answer_json FROM ask_answer WHERE question_id = ?1")
    .bind(q.id)
    .first<{ answer_json: string }>();
  const card = parseCard(cardRow?.answer_json ?? null);
  const prev = await db
    .prepare(
      `SELECT seq, kind, asked_by, body, reask_reason, reply_json FROM ask_turn
       WHERE question_id = ?1 AND deleted_at IS NULL AND seq < ?2 ORDER BY seq DESC LIMIT ?3`,
    )
    .bind(q.id, t.seq, ASK_THREAD_TURNS)
    .all<{
      seq: number;
      kind: AskTurnKind;
      asked_by: string;
      body: string;
      reask_reason: string | null;
      reply_json: string | null;
    }>();
  const turns = prev.results
    .slice()
    .reverse()
    .map((r) => ({
      by: r.asked_by,
      body: r.body,
      reply: parseFollowup(r.reply_json),
      kind: r.kind,
      reaskReason: r.reask_reason,
    }));
  const cardStage = cand.stage === "card";
  return {
    type: "turn",
    stage: cand.stage,
    cardUpdatesLeft: Math.max(0, ASK_REASK_MAX - q.card_updates),
    redLock: q.red_lock === 1 || q.red_flag === 1,
    turn: {
      id: t.id,
      seq: t.seq,
      kind: t.kind,
      body: t.body,
      redFlag: t.red_flag === 1,
      reaskReason: t.reask_reason,
      askedBy: t.asked_by,
      reply: cardStage ? parseFollowup(t.reply_json) : null,
      cardReason: cardStage ? t.card_reason : null,
      ...(t.kind === "reask"
        ? {
            reask: {
              count: Math.max(1, q.reask_count),
              reason: t.reask_reason ?? "",
              by: t.asked_by,
              previousAnswer: card,
            },
          }
        : {}),
    },
    thread: {
      question: {
        id: q.id,
        body: q.body,
        askedBy: q.asked_by,
        createdAt: q.created_at,
        redFlag: q.red_flag === 1,
      },
      card,
      turns,
    },
  };
}

// ───────────────────────── 턴 라우트 ─────────────────────────

interface TurnCtx {
  id: number;
  question_id: number;
  status: string;
  card_status: string;
  red_flag: number;
  created_at: string;
  claimed_at: string | null;
  tdel: string | null;
  qdel: string | null;
  red_lock: number;
  qred: number;
  card_updates: number;
}

async function loadCtx(db: D1Database, tid: number): Promise<TurnCtx | null> {
  return db
    .prepare(
      `SELECT t.id, t.question_id, t.status, t.card_status, t.red_flag, t.created_at, t.claimed_at,
              t.deleted_at AS tdel, q.deleted_at AS qdel, q.red_lock, q.red_flag AS qred, q.card_updates
       FROM ask_turn t JOIN ask_question q ON q.id = t.question_id WHERE t.id = ?1`,
    )
    .bind(tid)
    .first<TurnCtx>();
}

/** 턴과 부모 질문이 모두 살아 있는가. */
const alive = (c: TurnCtx | null): c is TurnCtx => c !== null && c.tdel === null && c.qdel === null;

/** 카드 batch 의 모든 문장이 다시 거는 수락 조건. ?1 = 턴 id. 턴·부모 삭제 안 됨, 카드 대기, 잠금이면 위급 턴만. */
const CARD_COND = `EXISTS (SELECT 1 FROM ask_turn ct JOIN ask_question cq ON cq.id = ct.question_id
   WHERE ct.id = ?1 AND ct.deleted_at IS NULL AND cq.deleted_at IS NULL
     AND ct.status = 'done' AND ct.card_status = 'pending'
     AND ((cq.red_lock = 0 AND cq.red_flag = 0) OR ct.red_flag = 1))`;

/** 짧은 답 확정 UPDATE 안에서 잠금을 다시 보는 식(잠긴 질문의 일반 턴은 카드로 가지 않는다). */
const REPLY_LOCK_OK = `(ask_turn.red_flag = 1 OR NOT EXISTS (SELECT 1 FROM ask_question lq
   WHERE lq.id = ask_turn.question_id AND (lq.red_lock = 1 OR lq.red_flag = 1)))`;

export function registerWorkerTurnRoutes(app: Hono<AppEnv>): void {
  // 짧은 답 단계 진행(상태·리스) 또는 카드 단계 하트비트(카드 리스만 — status 는 건드리지 않는다).
  app.post("/api/worker/ask/turn/:tid/progress", async (c) => {
    const tid = idOf(c.req.param("tid"));
    if (tid === null) return notFound();
    const parsed = TurnProgressSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return invalid();
    const db = c.env.DB;
    const nowMs = c.get("deps").now();
    await touchWorkerSeen(db, nowMs);
    const lease = iso(nowMs + LEASE_MS);
    const res =
      parsed.data.stage === "reply"
        ? await db
            .prepare(
              `UPDATE ask_turn SET status = ?1, lease_until = ?2, updated_at = ?3
               WHERE id = ?4 AND deleted_at IS NULL AND status IN ${WORKER_ACTIVE}
                 AND EXISTS (SELECT 1 FROM ask_question p WHERE p.id = ask_turn.question_id AND p.deleted_at IS NULL)`,
            )
            .bind(parsed.data.status, lease, iso(nowMs), tid)
            .run()
        : await db
            .prepare(
              `UPDATE ask_turn SET card_lease_until = ?1, updated_at = ?2
               WHERE id = ?3 AND deleted_at IS NULL AND status = 'done' AND card_status = 'pending'
                 AND EXISTS (SELECT 1 FROM ask_question p WHERE p.id = ask_turn.question_id AND p.deleted_at IS NULL)`,
            )
            .bind(lease, iso(nowMs), tid)
            .run();
    if (res.meta.changes === 0) return alive(await loadCtx(db, tid)) ? conflict() : notFound();
    return new Response(null, { status: 204 });
  });

  // 짧은 답 확정. 카드를 이어서 만들지(card_status) 는 서버가 같은 UPDATE 에서 잠금을 다시 보고 정한다.
  app.post("/api/worker/ask/turn/:tid/reply", async (c) => {
    const tid = idOf(c.req.param("tid"));
    if (tid === null) return notFound();
    const db = c.env.DB;
    const nowMs = c.get("deps").now();
    await touchWorkerSeen(db, nowMs);
    const ctx = await loadCtx(db, tid);
    if (!alive(ctx)) return notFound();
    if (!["claimed", "answering", "reviewing"].includes(ctx.status)) return conflict();
    const parsed = TurnReplySchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return invalid();
    const { reply, reviewScore, model, workMs, cardWanted, cardSkip, cardReason } = parsed.data;
    const json = JSON.stringify(reply);
    if (json.length > REPLY_JSON_MAX) return invalid("too_large");
    const strings: string[] = [];
    collectStrings(reply, strings);
    if (strings.some(hasForbiddenWord)) return invalid("forbidden_word");

    const now = iso(nowMs);
    const created = Date.parse(ctx.created_at);
    const waitMs = Math.max(
      0,
      (ctx.claimed_at === null ? created : Date.parse(ctx.claimed_at)) - created,
    );
    const totalMs = Math.max(0, nowMs - created);
    const row = await db
      .prepare(
        `UPDATE ask_turn
         SET status = 'done', reply_json = ?2, review_score = ?3, reply_model = ?4, work_ms = ?5, wait_ms = ?6,
             total_ms = ?7, replied_at = ?8, updated_at = ?8, lease_until = NULL, fail_code = NULL, card_reason = ?9,
             card_status = CASE WHEN ?10 = 1 AND ${REPLY_LOCK_OK} THEN 'pending' ELSE 'none' END,
             card_note = CASE WHEN ?10 = 1 THEN (CASE WHEN ${REPLY_LOCK_OK} THEN NULL ELSE 'redlock' END) ELSE ?11 END
         WHERE id = ?1 AND deleted_at IS NULL AND status IN ${WORKER_ACTIVE}
           AND EXISTS (SELECT 1 FROM ask_question p WHERE p.id = ask_turn.question_id AND p.deleted_at IS NULL)
         RETURNING card_status`,
      )
      .bind(
        tid,
        json,
        reviewScore,
        model,
        workMs,
        waitMs,
        totalMs,
        now,
        cardWanted ? cardReason : null,
        cardWanted ? 1 : 0,
        cardSkip,
      )
      .first<{ card_status: string }>();
    if (!row) return alive(await loadCtx(db, tid)) ? conflict() : notFound();
    return jsonResponse(200, { status: "done", cardStatus: row.card_status });
  });

  // 카드 갱신 업로드. 응답 순서: 404 → 409 → 422(형식) → 422 redflag_level → 429 card_limit → 나머지 422 → batch.
  app.post("/api/worker/ask/turn/:tid/card", async (c) => {
    const tid = idOf(c.req.param("tid"));
    if (tid === null) return notFound();
    const db = c.env.DB;
    const ctx = await loadCtx(db, tid);
    if (!alive(ctx)) return notFound();
    if (ctx.status !== "done" || ctx.card_status !== "pending") return conflict();
    const parsed = WorkerAnswerSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return invalid();
    const { level, answer, reviewScore, model, workMs } = parsed.data;
    const nowMs = c.get("deps").now();
    const now = iso(nowMs);
    const locked = ctx.red_lock === 1 || ctx.qred === 1;
    const isRedTurn = ctx.red_flag === 1;
    // 기록 UPDATE 는 모두 card_status='pending' 일 때만(다른 경로가 먼저 정리했으면 덮지 않는다).
    const note = (n: "redlock" | "limit") =>
      db
        .prepare(
          `UPDATE ask_turn SET card_status = 'none', card_note = ?2, updated_at = ?3
           WHERE id = ?1 AND card_status = 'pending'`,
        )
        .bind(tid, n, now)
        .run();
    if (locked && level !== 10) {
      if (!isRedTurn) await note("redlock");
      return invalid("redflag_level");
    }
    if (!isRedTurn && ctx.card_updates >= ASK_REASK_MAX) {
      await note("limit");
      return errorResponse(429, "card_limit", "카드는 세 번까지 다시 만들 수 있어요.");
    }
    if (answer.level !== level) return invalid("level_mismatch");
    const json = JSON.stringify(answer satisfies Answer);
    if (new TextEncoder().encode(json).byteLength > ASK_ANSWER_MAX_BYTES) {
      return invalid("too_large");
    }
    const strings: string[] = [];
    collectStrings(answer, strings);
    if (strings.some(hasForbiddenWord)) return invalid("forbidden_word");

    const qid = ctx.question_id;
    const totalMs = Math.max(0, nowMs - Date.parse(ctx.created_at));
    const [moved, , , done] = await db.batch([
      // ① 지금 카드를 이력으로(q.reask_count 조건은 두지 않는다 — 위급 갱신은 횟수와 무관하게 이력이 이어져야 한다)
      db
        .prepare(
          `INSERT INTO ask_answer_history (question_id, version, level, answer_json, review_score, model, total_ms, created_at)
           SELECT a.question_id,
                  (SELECT COALESCE(MAX(h.version), 0) + 1 FROM ask_answer_history h WHERE h.question_id = a.question_id),
                  a.level, a.answer_json, a.review_score, a.model, a.total_ms, a.created_at
           FROM ask_answer a WHERE a.question_id = ?2 AND ${CARD_COND}`,
        )
        .bind(tid, qid),
      // ② 현재 카드를 새 카드로(DELETE 없이 UPDATE: 카드가 비는 순간이 없다. 시간 열은 첫 답의 값을 둔다)
      db
        .prepare(
          `UPDATE ask_answer SET level = ?3, answer_json = ?4, review_score = ?5, model = ?6, created_at = ?7
           WHERE question_id = ?2 AND ${CARD_COND}`,
        )
        .bind(tid, qid, level, json, reviewScore, model, now),
      // ③ 갱신 횟수(위급 턴은 세지 않는다)
      db
        .prepare(
          `UPDATE ask_question SET card_updates = card_updates + 1, updated_at = ?3
           WHERE id = ?2 AND ${CARD_COND}
             AND EXISTS (SELECT 1 FROM ask_answer WHERE question_id = ?2)
             AND NOT EXISTS (SELECT 1 FROM ask_turn rt WHERE rt.id = ?1 AND rt.red_flag = 1)`,
        )
        .bind(tid, qid, now),
      // ④ 턴을 끝낸다. card_version = 이력 이동 뒤 최신 이력 번호 + 1
      db
        .prepare(
          `UPDATE ask_turn
           SET card_status = 'done',
               card_version = (SELECT COALESCE(MAX(v.version), 0) + 1 FROM ask_answer_history v WHERE v.question_id = ?2),
               card_model = ?3, card_work_ms = ?4, total_ms = ?5, card_note = NULL, card_fail_code = NULL,
               card_lease_until = NULL, updated_at = ?6
           WHERE id = ?1 AND ${CARD_COND} AND EXISTS (SELECT 1 FROM ask_answer WHERE question_id = ?2)
           RETURNING card_version`,
        )
        .bind(tid, qid, model, workMs, totalMs, now),
    ]);
    const version = done?.results[0] as { card_version: number } | undefined;
    if (moved?.meta.changes !== 1 || !version) return conflict();
    return jsonResponse(200, { status: "done", cardVersion: version.card_version });
  });

  // 단계별 실패 보고. 짧은 답 단계는 질문 fail 과 같은 규칙(냉각 없음), 카드 단계는 카드 시도 회계를 따로 쓴다.
  app.post("/api/worker/ask/turn/:tid/fail", async (c) => {
    const tid = idOf(c.req.param("tid"));
    if (tid === null) return notFound();
    const parsed = TurnFailSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) return invalid();
    const db = c.env.DB;
    const now = iso(c.get("deps").now());
    const parentLive = `EXISTS (SELECT 1 FROM ask_question p WHERE p.id = ask_turn.question_id AND p.deleted_at IS NULL)`;
    const row =
      parsed.data.stage === "reply"
        ? await db
            .prepare(
              `UPDATE ask_turn
               SET status = CASE WHEN attempts >= ?1 THEN 'failed' ELSE 'pending' END,
                   fail_code = ?2, lease_until = NULL, updated_at = ?3
               WHERE id = ?4 AND deleted_at IS NULL AND status IN ${WORKER_ACTIVE} AND ${parentLive}
               RETURNING status, card_status`,
            )
            .bind(MAX_ATTEMPTS, parsed.data.code, now, tid)
            .first<{ status: string; card_status: string }>()
        : await db
            .prepare(
              `UPDATE ask_turn
               SET card_status = CASE WHEN card_attempts >= ?1 THEN 'failed' ELSE 'pending' END,
                   card_fail_code = ?2, card_lease_until = NULL, updated_at = ?3
               WHERE id = ?4 AND deleted_at IS NULL AND status = 'done' AND card_status = 'pending' AND ${parentLive}
               RETURNING status, card_status`,
            )
            .bind(MAX_ATTEMPTS, parsed.data.code, now, tid)
            .first<{ status: string; card_status: string }>();
    if (!row) return conflict();
    return jsonResponse(200, { status: row.status, cardStatus: row.card_status });
  });
}
