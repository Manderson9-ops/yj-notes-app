// 답변 스키마의 단일 출처는 shared/ask-schema.ts (서버 검증과 같은 zod). 워커는 검토 출력 스키마만 따로 가진다.
import { z } from "zod";

export { AnswerSchema as answerSchema, type Answer } from "../../shared/ask-schema.ts";

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
