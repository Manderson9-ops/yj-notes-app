// 물어보기 대화 API(T-Q5): 후속 질문(/turn)과 다시 답변(/reask, 호환용 — 이제 카드만 만드는 턴을 만든다).
// 검사 우선순위(처음 걸리는 것): 422 형식 → 404 → 429 too_many(위급이면 건너뜀) → 409 question_busy
//   → 409 turn_active → 422 redflag_level(reask) → 429 turn_limit → 429 card_limit(reask).
// 위급 후속은 한도·동시 1건·잠금에서 제외한다. 질문·턴 본문은 로그·오류에 쓰지 않는다.
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { detectRedFlag } from "../ask/redflags";
import { TURN_ACTIVE, isUniqueViolation } from "../ask/turns";
import { errorResponse, jsonResponse } from "../http/errors";
import {
  ASK_REASK_MAX,
  ASK_TURN_MAX,
  AskReaskSchema,
  TurnCreateSchema,
  joinReaskReason,
  type ReaskChoice,
} from "../../shared/ask-schema";
import {
  badRequest,
  insertQuestion,
  invalid,
  iso,
  notFound,
  parseId,
  rateLimited,
  readBody,
  tooMany,
  conflict,
} from "./ask";

export const askTurnRoutes = new Hono<AppEnv>();

interface TurnState {
  status: string;
  red_lock: number;
  red_flag: number;
  card_updates: number;
  /** 활성 턴(짧은 답 단계 미완 또는 카드 만드는 중)이 있는가. */
  active: number;
  /** 위급이 아닌 삭제 안 된 턴 수(실패 포함). */
  used: number;
}

async function loadTurnState(db: D1Database, id: number): Promise<TurnState | null> {
  return db
    .prepare(
      `SELECT q.status, q.red_lock, q.red_flag, q.card_updates,
              EXISTS (SELECT 1 FROM ask_turn a WHERE a.question_id = q.id AND a.deleted_at IS NULL
                        AND (a.status IN ${TURN_ACTIVE} OR a.card_status = 'pending')) AS active,
              (SELECT COUNT(*) FROM ask_turn n WHERE n.question_id = q.id AND n.deleted_at IS NULL AND n.red_flag = 0) AS used
       FROM ask_question q WHERE q.id = ?1 AND q.deleted_at IS NULL`,
    )
    .bind(id)
    .first<TurnState>();
}

type Kind = "followup" | "reask";

/** 위급이 아닌 요청이 지금 거절돼야 하면 그 응답, 아니면 null. 우선순위는 파일 머리말과 같다. */
function refusal(kind: Kind, s: TurnState): Response | null {
  if (s.status !== "done") {
    return errorResponse(409, "question_busy", "답이 끝난 뒤에 이어서 물어볼 수 있어요.");
  }
  if (s.active === 1) {
    return errorResponse(409, "turn_active", "앞선 질문을 처리하는 중이에요.");
  }
  if (kind === "reask" && (s.red_lock === 1 || s.red_flag === 1)) {
    return errorResponse(422, "validation_error", "입력을 확인해 주세요.", {
      code: "redflag_level",
    });
  }
  if (s.used >= ASK_TURN_MAX) {
    return errorResponse(429, "turn_limit", "이어서 물어볼 수 있는 횟수를 모두 썼어요.");
  }
  if (kind === "reask" && s.card_updates >= ASK_REASK_MAX) {
    return errorResponse(429, "card_limit", "카드는 세 번까지 다시 만들 수 있어요.");
  }
  return null;
}

/** 일반 턴 INSERT 의 조건(한 문장 안에서 검사): 질문 done·삭제 아님, 활성 턴 없음, 위급 아닌 턴 수 < 한도. ?1=질문 ?2=한도 */
const TURN_GUARD = `EXISTS (SELECT 1 FROM ask_question g WHERE g.id = ?1 AND g.deleted_at IS NULL AND g.status = 'done')
  AND NOT EXISTS (SELECT 1 FROM ask_turn a WHERE a.question_id = ?1 AND a.deleted_at IS NULL
                    AND (a.status IN ${TURN_ACTIVE} OR a.card_status = 'pending'))
  AND (SELECT COUNT(*) FROM ask_turn n WHERE n.question_id = ?1 AND n.deleted_at IS NULL AND n.red_flag = 0) < ?2`;
/** reask 는 위에 위급 잠금 없음·카드 갱신 횟수 여유를 더한다. ?3=카드 갱신 한도 */
const REASK_GUARD = `${TURN_GUARD}
  AND EXISTS (SELECT 1 FROM ask_question g WHERE g.id = ?1 AND g.red_lock = 0 AND g.red_flag = 0 AND g.card_updates < ?3)`;

const NEXT_SEQ = "(SELECT COALESCE(MAX(s.seq), 0) + 1 FROM ask_turn s WHERE s.question_id = ?1)";

interface CreatedTurn {
  id: number;
  seq: number;
}

/** 두 번째 시도까지 UNIQUE(question_id, seq) 위반이면 한 번 다시 한다(동시에 들어온 두 위급 턴). */
async function retryOnSeqClash<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isUniqueViolation(e)) return run();
    throw e;
  }
}

async function insertFollowup(
  db: D1Database,
  qid: number,
  askedBy: string,
  body: string,
  nowIso: string,
): Promise<CreatedTurn | null> {
  const row = await retryOnSeqClash(() =>
    db
      .prepare(
        `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, red_flag, status, card_status, created_at, updated_at)
         SELECT ?1, ${NEXT_SEQ}, 'followup', ?3, ?4, 0, 'pending', 'none', ?5, ?5
         WHERE ${TURN_GUARD}
         RETURNING id, seq`,
      )
      .bind(qid, ASK_TURN_MAX, askedBy, body, nowIso)
      .first<CreatedTurn>(),
  );
  return row;
}

/** 위급 후속: 잠금 켜기 + 일반 카드 대기 정리 + 위급 턴을 한 묶음으로. UNIQUE 위반이면 묶음 전체를 한 번 다시 실행한다. */
async function insertRedTurn(
  db: D1Database,
  qid: number,
  askedBy: string,
  body: string,
  nowIso: string,
): Promise<CreatedTurn | null> {
  const doneGuard = `EXISTS (SELECT 1 FROM ask_question g WHERE g.id = ?1 AND g.deleted_at IS NULL AND g.status = 'done')`;
  const res = await retryOnSeqClash(() =>
    db.batch([
      db
        .prepare(
          `UPDATE ask_question SET red_lock = 1, updated_at = ?2 WHERE id = ?1 AND ${doneGuard}`,
        )
        .bind(qid, nowIso),
      db
        .prepare(
          `UPDATE ask_turn SET card_status = 'none', card_note = 'redlock', updated_at = ?2
           WHERE question_id = ?1 AND red_flag = 0 AND card_status = 'pending' AND deleted_at IS NULL AND ${doneGuard}`,
        )
        .bind(qid, nowIso),
      db
        .prepare(
          `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, red_flag, status, card_status, created_at, updated_at)
           SELECT ?1, ${NEXT_SEQ}, 'followup', ?3, ?4, 1, 'done', 'pending', ?2, ?2
           WHERE ${doneGuard}
           RETURNING id, seq`,
        )
        .bind(qid, nowIso, askedBy, body),
    ]),
  );
  const created = res[2]?.results[0] as CreatedTurn | undefined;
  return created ?? null;
}

/** 다시 답변 턴: 카드만 만드는 턴(짧은 답 없음) + 질문의 reask_* 갱신을 한 묶음으로. 조건이 같아 한쪽이 0행이면 다른 쪽도 0행이다. */
async function insertReaskTurn(
  db: D1Database,
  qid: number,
  by: string,
  text: string | undefined,
  reason: string,
  nowIso: string,
): Promise<{ turn: CreatedTurn; reaskCount: number } | null> {
  const res = await retryOnSeqClash(() =>
    db.batch([
      db
        .prepare(
          `UPDATE ask_question
           SET reask_count = reask_count + 1, reask_reason = ?5, reask_by = ?4, reask_at = ?6, updated_at = ?6
           WHERE id = ?1 AND ${REASK_GUARD}
           RETURNING reask_count`,
        )
        .bind(qid, ASK_TURN_MAX, ASK_REASK_MAX, by, reason, nowIso),
      db
        .prepare(
          `INSERT INTO ask_turn (question_id, seq, kind, asked_by, body, reask_reason, red_flag, status, card_status, created_at, updated_at)
           SELECT ?1, ${NEXT_SEQ}, 'reask', ?4, ?7, ?5, 0, 'done', 'pending', ?6, ?6
           WHERE ${REASK_GUARD}
           RETURNING id, seq`,
        )
        .bind(qid, ASK_TURN_MAX, ASK_REASK_MAX, by, reason, nowIso, text ?? ""),
    ]),
  );
  const bumped = res[0]?.results[0] as { reask_count: number } | undefined;
  const turn = res[1]?.results[0] as CreatedTurn | undefined;
  if (!bumped || !turn) return null;
  return { turn, reaskCount: bumped.reask_count };
}

type Spec =
  | { kind: "followup"; askedBy: string; body: string }
  | { kind: "reask"; askedBy: string; choice: ReaskChoice; text: string | undefined };

/** /turn 과 /reask 가 같이 쓰는 생성 흐름. */
async function createTurn(
  db: D1Database,
  qid: number,
  spec: Spec,
  nowMs: number,
): Promise<Response> {
  const nowIso = iso(nowMs);
  // 위급 판정이 레이트리밋보다 먼저다(위급이면 한도를 건너뛴다). reask 는 자유 글이 있을 때만 판정한다.
  const freeText = spec.kind === "followup" ? spec.body : spec.text;
  const redText = freeText !== undefined && detectRedFlag(freeText).redFlag ? freeText : null;

  const state = await loadTurnState(db, qid);
  if (!state) return notFound();
  if (redText === null && (await rateLimited(db, spec.askedBy, nowMs))) return tooMany();

  if (redText !== null) {
    if (state.status !== "done") {
      // 붙일 카드가 아직 없다: 턴 대신 새 위급 질문으로 이어 준다.
      const newId = await insertQuestion(db, spec.askedBy, redText, 1, nowIso, qid);
      return jsonResponse(201, { newQuestionId: newId, redFlag: true });
    }
    const created = await insertRedTurn(db, qid, spec.askedBy, redText, nowIso);
    // 위급 턴은 활성·한도 검사를 받지 않는다: 0행이면 그사이 질문이 지워진 것뿐이라 일반 후속의 거절 코드를 내지 않는다.
    if (!created) return (await loadTurnState(db, qid)) ? conflict() : notFound();
    return jsonResponse(201, { id: created.id, seq: created.seq, redFlag: true });
  }

  const early = refusal(spec.kind, state);
  if (early) return early;

  if (spec.kind === "followup") {
    const created = await insertFollowup(db, qid, spec.askedBy, spec.body, nowIso);
    if (!created) return raceResponse(db, qid, "followup");
    return jsonResponse(201, { id: created.id, seq: created.seq, redFlag: false });
  }
  const made = await insertReaskTurn(
    db,
    qid,
    spec.askedBy,
    spec.text,
    joinReaskReason(spec.choice, spec.text),
    nowIso,
  );
  if (!made) return raceResponse(db, qid, "reask");
  return jsonResponse(200, {
    status: "done",
    reaskCount: made.reaskCount,
    id: made.turn.id,
    seq: made.turn.seq,
  });
}

/** 조건부 INSERT 가 0행이었다: 그사이 상태가 바뀐 것이다. 다시 읽어 맞는 코드를 낸다. */
async function raceResponse(
  db: D1Database,
  qid: number,
  kind: Kind = "followup",
): Promise<Response> {
  const s = await loadTurnState(db, qid);
  if (!s) return notFound();
  return refusal(kind, s) ?? conflict();
}

askTurnRoutes.post("/api/ask/:id/turn", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const body = await readBody(c.req.raw);
  if (body === undefined) return badRequest();
  const parsed = TurnCreateSchema.safeParse(body);
  if (!parsed.success) return invalid();
  return createTurn(
    c.env.DB,
    id,
    { kind: "followup", askedBy: parsed.data.askedBy, body: parsed.data.body },
    c.get("deps").now(),
  );
});

// 호환용: 예전 「다시 답변」 요청. 이제 질문을 되돌리거나 답을 지우지 않고, 카드만 만드는 턴을 만든다.
askTurnRoutes.post("/api/ask/:id/reask", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return notFound();
  const body = await readBody(c.req.raw);
  if (body === undefined) return badRequest();
  const parsed = AskReaskSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const { by, choice, text } = parsed.data;
  return createTurn(
    c.env.DB,
    id,
    { kind: "reask", askedBy: by, choice, text },
    c.get("deps").now(),
  );
});
