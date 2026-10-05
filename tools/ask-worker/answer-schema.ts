// 답변 JSON 스키마(zod). answer.schema.json 과 같은 내용이어야 한다(answer-schema.test.ts 가 대조).
import { z } from "zod";

const text = z.string().max(600);
const list = (min: number, max: number) => z.array(text).min(min).max(max);

export const answerSchema = z.strictObject({
  level: z.number().int().min(1).max(10),
  levelTitle: text,
  levelReason: text,
  summary: text,
  fromRecords: z
    .array(
      z.strictObject({
        date: z
          .string()
          .max(600)
          .regex(/^\d{4}-\d{2}-\d{2}$/),
        what: text,
        source: z.enum(["알림장", "관찰", "검진", "가족기록"]),
      }),
    )
    .max(6),
  evidence: z
    .array(z.strictObject({ ref: text, point: text, grade: text.optional() }))
    .min(1)
    .max(6),
  tryNow: z
    .array(z.strictObject({ action: text, say: text.optional() }))
    .min(2)
    .max(4),
  avoid: list(1, 4),
  observe: z.strictObject({ what: text, howLong: text, how: text }),
  upIf: list(1, 4),
  downIf: list(1, 4),
  forAsker: text.optional(),
  limits: text.optional(),
});

export type Answer = z.infer<typeof answerSchema>;

export const reviewSchema = z.strictObject({
  score: z.number().min(0).max(10),
  rubric: z.strictObject({
    evidence: z.number().min(0).max(3),
    records: z.number().min(0).max(2),
    actionable: z.number().min(0).max(2),
    safety: z.number().min(0).max(1.5),
    tone: z.number().min(0).max(1.5),
  }),
  levelConsistent: z.boolean(),
  issues: z.array(z.string().max(400)).max(12),
});

export type Review = z.infer<typeof reviewSchema>;

// claude --json-schema 에 넘기는 검토 스키마(reviewSchema 와 동일 제약).
export const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "rubric", "levelConsistent", "issues"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 10 },
    rubric: {
      type: "object",
      additionalProperties: false,
      required: ["evidence", "records", "actionable", "safety", "tone"],
      properties: {
        evidence: { type: "number", minimum: 0, maximum: 3 },
        records: { type: "number", minimum: 0, maximum: 2 },
        actionable: { type: "number", minimum: 0, maximum: 2 },
        safety: { type: "number", minimum: 0, maximum: 1.5 },
        tone: { type: "number", minimum: 0, maximum: 1.5 },
      },
    },
    levelConsistent: { type: "boolean" },
    issues: { type: "array", maxItems: 12, items: { type: "string", maxLength: 400 } },
  },
} as const;
