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

export const AnswerSchema = z.strictObject({
  level: z.number().int().min(1).max(10),
  levelTitle: text(40),
  levelReason: text(),
  summary: text(),
  fromRecords: z
    .array(
      z.strictObject({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        what: text(),
        source: z.enum(RECORD_SOURCES),
      }),
    )
    .max(6),
  evidence: z
    .array(
      z.strictObject({
        ref: text(120),
        point: text(),
        grade: text(40).optional(),
      }),
    )
    .min(1)
    .max(6),
  tryNow: z
    .array(z.strictObject({ action: text(), say: text().optional() }))
    .min(2)
    .max(4),
  avoid: z.array(text()).min(1).max(4),
  observe: z.strictObject({ what: text(), howLong: text(), how: text() }),
  upIf: z.array(text()).min(1).max(4),
  downIf: z.array(text()).min(1).max(4),
  forAsker: text().optional(),
  limits: text().optional(),
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
