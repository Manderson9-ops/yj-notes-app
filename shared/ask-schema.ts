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

export const AnswerSchema = z.strictObject({
  level: z.number().int().min(1).max(10),
  levelTitle: text(40),
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
    .min(1)
    .max(6),
  tryNow: z
    .array(
      z.strictObject({
        action: text(ASK_LIMITS.tryAction),
        say: text(ASK_LIMITS.tryNowSay).optional(),
        /** 근거 묶음 ref 또는 정확히 「일반 권고」. */
        basis: text(120),
      }),
    )
    .min(1)
    .max(3),
  avoid: z.array(text(ASK_LIMITS.avoidItem)).min(1).max(3),
  observe: z.strictObject({ what: text(100), howLong: text(40), how: text(200) }),
  upIf: z.array(text(ASK_LIMITS.signalItem)).min(1).max(3),
  downIf: z.array(text(ASK_LIMITS.signalItem)).min(1).max(3),
  forAsker: text(160).optional(),
  limits: text(ASK_LIMITS.limits).optional(),
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
