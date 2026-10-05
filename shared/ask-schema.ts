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
  levelTitle: text(40),
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
    if (a.fromRecords.length > 0) bad("fromRecords");
    if (a.evidence.length > 0) bad("evidence");
    if (a.tryNow.length > 0) bad("tryNow");
    if (a.avoid.length > 0) bad("avoid");
    if (a.upIf.length > 0) bad("upIf");
    if (a.downIf.length > 0) bad("downIf");
    if (a.observe !== undefined) bad("observe");
    return;
  }
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

export const AskFeedbackSchema = z
  .strictObject({
    by: AskerSchema,
    helpful: z.boolean().nullable().optional(),
    note: z.string().trim().min(1).max(ASK_NOTE_MAX).optional(),
  })
  .refine((v) => (v.helpful !== undefined && v.helpful !== null) || v.note !== undefined);

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

/** 워커 --json-schema 용 JSON Schema (draft-7). */
export function answerJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AnswerSchema, { target: "draft-7" });
}
