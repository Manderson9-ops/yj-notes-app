// 커밋된 워커용 JSON Schema 가 shared/ask-schema.ts 와 같은지 확인한다(다르면 `npm run ask:schema` 로 다시 만든다).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { answerJsonSchema, followupJsonSchema, FollowupSchema } from "../shared/ask-schema.ts";

describe("tools/ask-worker/answer.schema.json", () => {
  it("shared/ask-schema.ts 에서 생성한 것과 정확히 같다", () => {
    const committed = readFileSync(
      new URL("./ask-worker/answer.schema.json", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(`${JSON.stringify(answerJsonSchema(), null, 2)}\n`);
  });
});

describe("tools/ask-worker/followup.schema.json (T-Q5 짧은 답)", () => {
  it("shared/ask-schema.ts 에서 생성한 것과 정확히 같다", () => {
    const committed = readFileSync(
      new URL("./ask-worker/followup.schema.json", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(`${JSON.stringify(followupJsonSchema(), null, 2)}\n`);
  });

  it("필수 필드·추가 필드 금지가 스키마에 실려 있다", () => {
    const s = followupJsonSchema() as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { maxLength?: number }>;
    };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(
      expect.arrayContaining(["reply", "fromRecords", "evidence", "cardUpdate"]),
    );
    expect(s.properties.reply?.maxLength).toBe(600);
  });

  it("zod 스키마와 같은 경계: 최소 합격본은 통과, 모르는 키·카드 갱신 누락은 거절", () => {
    const ok = {
      reply: "저녁에 천천히 앉아 먹어요.",
      fromRecords: [],
      evidence: [],
      cardUpdate: { needed: false, reason: "" },
    };
    expect(FollowupSchema.safeParse(ok).success).toBe(true);
    expect(FollowupSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(FollowupSchema.safeParse({ ...ok, cardUpdate: undefined }).success).toBe(false);
    expect(FollowupSchema.safeParse({ ...ok, reply: "가".repeat(601) }).success).toBe(false);
  });
});
