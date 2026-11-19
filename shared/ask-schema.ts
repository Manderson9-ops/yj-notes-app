// 물어보기(T-Q) 공용 스키마: 앱 화면·서버 검증·워커 --json-schema 가 같은 정의를 쓴다.
// JSON Schema 는 `npm run ask:schema` 가 tools/ask-worker/answer.schema.json 으로 내보낸다(일치는 시험이 확인).
import { z } from "zod";

const text = (max = 600) => z.string().min(1).max(max);

export const ASK_BODY_MAX = 1000;
export const ASK_NOTE_MAX = 500;
export const ASK_ANSWER_MAX_BYTES = 60 * 1024;
export const ASK_RECORDER_MAX = 12;

export const ASK_STATUSES = [
  "pending",
  "claimed",
  "answering",
  "reviewing",
  "done",
  "failed",
] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

export const RECORD_SOURCES = ["알림장", "관찰", "검진", "가족기록"] as const;

/** tryNow.basis 에 근거 묶음 ref 대신 쓰는 값: 묶음에 없는 일반적인 권고임을 밝힌다(화면에 작은 「일반 권고」 표시). */
export const GENERAL_BASIS = "일반 권고";

/** 길이 상한: 가족이 한눈에 읽도록 짧게 묶는다(프롬프트·결정적 검사·화면 공용). */
export const ASK_LIMITS = {
  summary: 120,
  levelReason: 220,
  tryAction: 160,
  tryNowSay: 80,
  avoidItem: 100,
  signalItem: 120,
  limits: 160,
  recordWhat: 140,
  recordLink: 80,
  point: 200,
} as const;

/** 답 종류: 행동 질문이면 behavior, 이 기능이 도울 수 없는 글(상관없는 질문·지시 글 등)이면 not_behavior(단계 1, 요약+안내 한 줄만). */
export const ANSWER_KINDS = ["behavior", "not_behavior"] as const;

const AnswerBase = z.strictObject({
  kind: z.enum(ANSWER_KINDS),
  level: z.number().int().min(1).max(10),
  /** behavior: 정본 단계 제목. not_behavior: 빈 문자열(단계를 보이지 않는다). */
  levelTitle: z.string().max(40),
  /** behavior: 왜 이 단계인지. not_behavior: 이 기능이 도울 수 있는 일을 알리는 짧은 안내 한 줄. */
  levelReason: text(ASK_LIMITS.levelReason),
  summary: text(ASK_LIMITS.summary),
  fromRecords: z
    .array(
      z.strictObject({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        what: text(ASK_LIMITS.recordWhat),
        /** 이 기록이 질문과 어떻게 이어지는지(필수). */
        link: text(ASK_LIMITS.recordLink),
        source: z.enum(RECORD_SOURCES),
      }),
    )
    .max(4),
  evidence: z
    .array(
      z.strictObject({
        ref: text(120),
        point: text(ASK_LIMITS.point),
        grade: text(40).optional(),
      }),
    )
    .max(3),
  tryNow: z
    .array(
      z.strictObject({
        action: text(ASK_LIMITS.tryAction),
        say: text(ASK_LIMITS.tryNowSay).optional(),
        /** 근거 묶음 ref 또는 정확히 「일반 권고」. */
        basis: text(120),
      }),
    )
    .max(3),
  avoid: z.array(text(ASK_LIMITS.avoidItem)).max(3),
  observe: z.strictObject({ what: text(100), howLong: text(40), how: text(200) }).optional(),
  upIf: z.array(text(ASK_LIMITS.signalItem)).max(3),
  downIf: z.array(text(ASK_LIMITS.signalItem)).max(3),
  /** 질문자 맞춤 한 줄(필수). 가족 역할은 적힌 그대로(엄마·아빠·할머니·할아버지). */
  forAsker: text(160),
  limits: text(ASK_LIMITS.limits).optional(),
});

/** behavior 는 내용이 다 있어야 하고, not_behavior 는 단계 1에 요약·안내만(기록·근거를 싣지 않는다). */
export const AnswerSchema = AnswerBase.superRefine((a, ctx) => {
  const bad = (path: string) => {
    ctx.addIssue({ code: "custom", path: [path], message: "kind_rule" });
  };
  if (a.kind === "not_behavior") {
    if (a.level !== 1) bad("level");
    if (a.levelTitle !== "") bad("levelTitle");
    if (a.fromRecords.length > 0) bad("fromRecords");
    if (a.evidence.length > 0) bad("evidence");
    if (a.tryNow.length > 0) bad("tryNow");
    if (a.avoid.length > 0) bad("avoid");
    if (a.upIf.length > 0) bad("upIf");
    if (a.downIf.length > 0) bad("downIf");
    if (a.observe !== undefined) bad("observe");
    return;
  }
  if (a.levelTitle === "") bad("levelTitle");
  if (a.evidence.length < 1) bad("evidence");
  if (a.tryNow.length < 1) bad("tryNow");
  if (a.avoid.length < 1) bad("avoid");
  if (a.upIf.length < 1) bad("upIf");
  if (a.downIf.length < 1) bad("downIf");
  if (a.observe === undefined) bad("observe");
});
export type Answer = z.infer<typeof AnswerSchema>;

/** 질문자 이름: 기존 기록자 체계(1~12자). */
export const AskerSchema = z.string().trim().min(1).max(ASK_RECORDER_MAX);

export const AskCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(ASK_BODY_MAX),
  askedBy: AskerSchema,
});

/** 해 봤어요 메모만(도움 여부는 PUT /api/ask/:id/vote). helpful 은 받지 않는다(strict). */
export const AskFeedbackSchema = z.strictObject({
  by: AskerSchema,
  note: z.string().trim().min(1).max(ASK_NOTE_MAX),
});

export const ASK_VOTE_REASON_MAX = 200;
export const ASK_REASK_MAX = 3;
export const ASK_REASK_TEXT_MAX = 280;
export const ASK_REASK_REASON_MAX = 300;
/** 한 질문에 표를 남길 수 있는 서로 다른 사람 수 상한(가족 규모 기준 남용 방지). */
export const ASK_VOTERS_MAX = 12;

/** 표: helpful true/false, null 이면 취소(삭제). 이유는 👎 때만. */
export const AskVoteSchema = z
  .strictObject({
    by: AskerSchema,
    helpful: z.boolean().nullable(),
    reason: z.string().trim().min(1).max(ASK_VOTE_REASON_MAX).optional(),
  })
  .refine((v) => v.reason === undefined || v.helpful === false);

/** 다시 답변 이유 선택지. */
export const REASK_CHOICES = [
  "너무 일반적이에요",
  "이미 해 봤어요",
  "우리 상황과 달라요",
  "더 자세히 알고 싶어요",
] as const;
export type ReaskChoice = (typeof REASK_CHOICES)[number];

export const AskReaskSchema = z.strictObject({
  by: AskerSchema,
  choice: z.enum(REASK_CHOICES),
  text: z.string().trim().min(1).max(ASK_REASK_TEXT_MAX).optional(),
});

/** 저장·전달용 이유 한 줄: 「선택지」 또는 「선택지 · 자유 글」(≤300자). */
export function joinReaskReason(choice: ReaskChoice, text?: string): string {
  return text === undefined ? choice : `${choice} · ${text}`;
}

/** 이유 한 줄에서 선택지와 자유 글을 나눈다(선택지가 아니면 choice null). */
export function splitReaskReason(reason: string): { choice: ReaskChoice | null; text: string } {
  for (const c of REASK_CHOICES) {
    if (reason === c) return { choice: c, text: "" };
    if (reason.startsWith(`${c} · `)) return { choice: c, text: reason.slice(c.length + 3) };
  }
  return { choice: null, text: reason };
}

/** 워커 history 응답 크기 상한(바이트). */
export const ASK_HISTORY_MAX_BYTES = 200 * 1024;
export const ASK_HISTORY_DEFAULT_LIMIT = 60;
export const ASK_HISTORY_MAX_LIMIT = 100;

export const HistoryItemSchema = z.object({
  id: z.number().int(),
  body: z.string(),
  askedBy: z.string(),
  createdAt: z.string(),
  level: z.number().int().min(1).max(10),
  tryNowActions: z.array(z.string()),
  votes: z.array(
    z.object({
      by: z.string(),
      helpful: z.boolean(),
      reason: z.string().nullable(),
      /** 표를 남기거나 바꾼 시각(ISO). 워커의 최근 30일 요약에 쓴다. */
      updatedAt: z.string(),
    }),
  ),
  notes: z.array(z.object({ by: z.string(), note: z.string(), createdAt: z.string() })),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;
export const HistoryResponseSchema = z.object({ items: z.array(HistoryItemSchema) });

/** claim 응답의 reask 덩어리. */
export const ClaimReaskSchema = z.object({
  count: z.number().int().min(1),
  reason: z.string(),
  by: z.string(),
  previousAnswer: AnswerSchema.nullable(),
});
export type ClaimReask = z.infer<typeof ClaimReaskSchema>;
export const WorkerAnswerSchema = z.strictObject({
  level: z.number().int().min(1).max(10),
  answer: AnswerSchema,
  reviewScore: z.number().min(0).max(10),
  model: z.string().trim().min(1).max(60),
  workMs: z.number().int().min(0).max(86_400_000),
});

export const WorkerProgressSchema = z.strictObject({
  status: z.enum(["answering", "reviewing"]),
});

export const WorkerFailSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9_]{1,40}$/),
});

// ───────────────────────── T-Q5 대화(후속 질문·짧은 답·카드 갱신) ─────────────────────────

/** 후속 질문 상한(위급 턴은 세지 않는다). 11번째는 429 turn_limit. */
export const ASK_TURN_MAX = 10;
/** 짧은 답 본문 상한. */
export const ASK_TURN_REPLY_MAX = 600;
/** thread 로 워커에 싣는 이전 턴 수(위급 턴 포함, 최근 것만). */
export const ASK_THREAD_TURNS = 10;
export const ASK_TURN_KINDS = ["followup", "reask"] as const;
export type AskTurnKind = (typeof ASK_TURN_KINDS)[number];
/** 카드 단계 상태: none(카드 갱신 없음/끝)·pending(만드는 중)·done·failed. */
export const ASK_CARD_STATUSES = ["none", "pending", "done", "failed"] as const;
export type AskCardStatus = (typeof ASK_CARD_STATUSES)[number];
/** 카드를 갱신하지 않은 이유 표지(화면 문구용). */
export const ASK_CARD_NOTES = ["limit", "redlock"] as const;
export type AskCardNote = (typeof ASK_CARD_NOTES)[number];

/** 후속 짧은 답. 카드 전체가 아니라 질문에 대한 대답 한 덩어리 + 카드 갱신 필요 여부. */
export const FollowupSchema = z.strictObject({
  reply: text(ASK_TURN_REPLY_MAX),
  say: text(ASK_LIMITS.tryNowSay).optional(),
  fromRecords: z
    .array(
      z.strictObject({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        what: text(ASK_LIMITS.recordWhat),
        link: text(ASK_LIMITS.recordLink),
        source: z.enum(RECORD_SOURCES),
      }),
    )
    .max(2),
  evidence: z.array(z.strictObject({ ref: text(120), point: text(ASK_LIMITS.point) })).max(2),
  /** 원래 답 카드를 새 버전으로 고쳐야 하면 needed=true(이유 ≤160, 필요 없으면 빈 문자열 가능). */
  cardUpdate: z.strictObject({ needed: z.boolean(), reason: z.string().max(160) }),
  limits: text(ASK_LIMITS.limits).optional(),
});
export type Followup = z.infer<typeof FollowupSchema>;

/** POST /api/ask/:id/turn 본문(후속 질문). */
export const TurnCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(ASK_BODY_MAX),
  askedBy: AskerSchema,
});

/** 짧은 답 단계 진행 / 카드 단계 하트비트(카드 단계는 status 를 바꾸지 않고 카드 리스만 늘린다). */
export const TurnProgressSchema = z.union([
  z.strictObject({ stage: z.literal("reply"), status: z.enum(["answering", "reviewing"]) }),
  z.strictObject({ stage: z.literal("card") }),
]);
export type TurnProgress = z.infer<typeof TurnProgressSchema>;

/** 짧은 답 확정. reviewScore 는 숫자만(null 은 T-Q4b 의 미검토 확정이라 지금은 받지 않는다). */
export const TurnReplySchema = z.strictObject({
  reply: FollowupSchema,
  reviewScore: z.number().min(0).max(10),
  model: z.string().trim().min(1).max(60),
  workMs: z.number().int().min(0).max(86_400_000),
  /** 카드를 이어서 만들 것인가(cardUpdate.needed && 남은 횟수 > 0 && 위급 잠금 아님). */
  cardWanted: z.boolean(),
  /** cardWanted 가 false 인 이유(limit·redlock). 카드가 필요 없었으면 null. */
  cardSkip: z.enum(ASK_CARD_NOTES).nullable(),
  /** cardUpdate.reason 그대로(카드 단계 claim 에서 다시 실어 준다). */
  cardReason: z.string().max(160),
});
export type TurnReply = z.infer<typeof TurnReplySchema>;

/** 턴 실패 보고: 어느 단계가 실패했는지 함께. */
export const TurnFailSchema = z.strictObject({
  stage: z.enum(["reply", "card"]),
  code: z.string().regex(/^[a-z0-9_]{1,40}$/),
});
export type TurnFail = z.infer<typeof TurnFailSchema>;

/** claim 응답의 thread: 원 질문·현재 카드·지금 턴 앞의 최근 턴들. */
export const ClaimThreadSchema = z.object({
  question: z.object({
    id: z.number().int(),
    body: z.string(),
    askedBy: z.string(),
    createdAt: z.string(),
    redFlag: z.boolean(),
  }),
  card: AnswerSchema.nullable(),
  turns: z.array(
    z.object({
      by: z.string(),
      body: z.string(),
      reply: FollowupSchema.nullable(),
      /** 추가 필드(reask 턴은 본문이 비어 있을 수 있어 이유를 함께 싣는다). */
      kind: z.enum(ASK_TURN_KINDS),
      reaskReason: z.string().nullable(),
    }),
  ),
});
export type ClaimThread = z.infer<typeof ClaimThreadSchema>;

/** claim 응답의 turn 덩어리(지금 처리할 턴). */
export const ClaimTurnSchema = z.object({
  id: z.number().int(),
  seq: z.number().int(),
  kind: z.enum(ASK_TURN_KINDS),
  body: z.string(),
  redFlag: z.boolean(),
  reaskReason: z.string().nullable(),
  askedBy: z.string(),
  /** 카드 단계 claim 일 때만: 이 턴이 확정한 짧은 답. */
  reply: FollowupSchema.nullable(),
  /** 카드 단계 claim 일 때만: /reply 때 받은 cardUpdate.reason. */
  cardReason: z.string().nullable(),
  /** reask 턴일 때만: buildReaskSection 입력(count = 그 질문의 reask_count, previousAnswer = 지금 카드). */
  reask: ClaimReaskSchema.optional(),
});
export type ClaimTurn = z.infer<typeof ClaimTurnSchema>;

/** 턴 claim 응답 전체. 최상위 question 이 없다 — 옛 워커가 질문으로 오해해 처리하지 못하게(§2 배포 순서). */
export const ClaimTurnResponseSchema = z.object({
  type: z.literal("turn"),
  stage: z.enum(["reply", "card"]),
  cardUpdatesLeft: z.number().int().min(0),
  redLock: z.boolean(),
  turn: ClaimTurnSchema,
  thread: ClaimThreadSchema,
});
export type ClaimTurnResponse = z.infer<typeof ClaimTurnResponseSchema>;

/** 워커 --json-schema 용 JSON Schema (draft-7). */
export function answerJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AnswerSchema, { target: "draft-7" });
}

/** 후속 짧은 답용 JSON Schema (draft-7). */
export function followupJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(FollowupSchema, { target: "draft-7" });
}
