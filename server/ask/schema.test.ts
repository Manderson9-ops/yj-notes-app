import { describe, expect, it } from "vitest";
import {
  ASK_LEVELS,
  checkLevelTemplate,
  levelInfo,
  levelTemplateText,
} from "../../shared/ask-levels";
import {
  AnswerSchema,
  AskCreateSchema,
  AskFeedbackSchema,
  answerJsonSchema,
} from "../../shared/ask-schema";
import { questionTokens, snippetAround } from "./instant";
import { syntheticAnswer } from "../test-utils/ask";

describe("AnswerSchema", () => {
  it("합성 답은 통과하고 선택 항목(forAsker·limits·say·grade)은 없어도 된다", () => {
    expect(AnswerSchema.safeParse(syntheticAnswer(1)).success).toBe(true);
    expect(
      AnswerSchema.safeParse(
        syntheticAnswer(10, { forAsker: "할머니께는 이렇게", limits: "알림장 한계" }),
      ).success,
    ).toBe(true);
  });
  it("경계: 배열 개수·글자 수", () => {
    const base = syntheticAnswer(5);
    const bad = (over: object) => AnswerSchema.safeParse({ ...base, ...over }).success;
    expect(bad({ fromRecords: Array.from({ length: 5 }, () => base.fromRecords[0]) })).toBe(false);
    expect(bad({ fromRecords: Array.from({ length: 4 }, () => base.fromRecords[0]) })).toBe(true);
    expect(bad({ fromRecords: [] })).toBe(true);
    expect(bad({ evidence: Array.from({ length: 7 }, () => base.evidence[0]) })).toBe(false);
    expect(bad({ tryNow: Array.from({ length: 4 }, () => base.tryNow[0]) })).toBe(false);
    expect(bad({ tryNow: [] })).toBe(false);
    expect(bad({ avoid: Array.from({ length: 4 }, () => "가") })).toBe(false);
    expect(bad({ upIf: Array.from({ length: 4 }, () => "가") })).toBe(false);
    expect(bad({ avoid: [] })).toBe(false);
    expect(bad({ downIf: [] })).toBe(false);
    expect(bad({ levelReason: "가".repeat(220) })).toBe(true);
    expect(bad({ levelReason: "가".repeat(221) })).toBe(false);
    expect(bad({ summary: "가".repeat(121) })).toBe(false);
    expect(bad({ limits: "가".repeat(161) })).toBe(false);
    expect(bad({ level: 1.5 })).toBe(false);
  });
  it("tryNow.basis·fromRecords.link 는 필수, 길이 상한이 있다", () => {
    const base = syntheticAnswer(5);
    const noBasis = { ...base, tryNow: [{ action: "가" }] };
    expect(AnswerSchema.safeParse(noBasis).success).toBe(false);
    const noLink = { ...base, fromRecords: [{ date: "2020-01-15", what: "가", source: "알림장" }] };
    expect(AnswerSchema.safeParse(noLink).success).toBe(false);
    const longAction = { ...base, tryNow: [{ action: "가".repeat(161), basis: "일반 권고" }] };
    expect(AnswerSchema.safeParse(longAction).success).toBe(false);
    const longSay = {
      ...base,
      tryNow: [{ action: "가", say: "가".repeat(81), basis: "일반 권고" }],
    };
    expect(AnswerSchema.safeParse(longSay).success).toBe(false);
    const longLink = { ...base, fromRecords: [{ ...base.fromRecords[0], link: "가".repeat(81) }] };
    expect(AnswerSchema.safeParse(longLink).success).toBe(false);
  });
});

describe("단계별 답변 틀", () => {
  const ans = (level: number, n: number, howLong: string, upIf: string[]) => ({
    level,
    tryNow: Array.from({ length: n }, () => ({})),
    observe: { howLong },
    upIf,
  });
  it("개수·관찰 기간·연락처를 정확한 문장으로 알린다", () => {
    expect(checkLevelTemplate(ans(4, 2, "3~4일", ["늘면 소아과에 물어봐요"]))).toEqual([]);
    expect(checkLevelTemplate(ans(4, 4, "1주", ["늘어요"]))).toEqual([
      "단계 4 은 tryNow 가 2~2개여야 해요(지금 4개)",
      "단계 4 의 observe.howLong 은 「3~4일」 이어야 해요",
      "upIf 중 하나에 연락할 곳(소아과·어린이집 선생님·발달 상담·119)을 적어야 해요",
    ]);
    expect(checkLevelTemplate(ans(1, 1, "며칠 지켜보기", ["늘어요"]))).toEqual([]);
    expect(checkLevelTemplate(ans(1, 3, "며칠", [])).length).toBe(1);
    expect(checkLevelTemplate(ans(5, 3, "1주", ["어린이집 선생님께 말해요"]))).toEqual([]);
    expect(checkLevelTemplate(ans(5, 3, "2주", ["어린이집 선생님께 말해요"])).length).toBe(1);
    expect(checkLevelTemplate(ans(6, 2, "2주", ["발달 상담을 받아요"]))).toEqual([]);
    expect(checkLevelTemplate(ans(9, 2, "진료·상담 전까지", ["119"]))).toEqual([]);
    expect(checkLevelTemplate(ans(10, 1, "지금", ["119에 전화해요"]))).toEqual([]);
    expect(checkLevelTemplate(ans(10, 4, "지금", ["119"])).length).toBe(1);
  });
  it("모든 단계에 틀이 있고 안내 문장이 나온다", () => {
    for (let l = 1; l <= 10; l++) expect(levelTemplateText(l)).toContain("해 볼 것");
    expect(levelTemplateText(4)).toContain("3~4일");
  });
});

describe("질문·의견 입력", () => {
  it("질문 글은 앞뒤 공백을 자르고 1~1000자", () => {
    expect(AskCreateSchema.parse({ body: "  가  ", askedBy: " 엄마 " })).toEqual({
      body: "가",
      askedBy: "엄마",
    });
    expect(AskCreateSchema.safeParse({ body: "", askedBy: "엄마" }).success).toBe(false);
  });
  it("의견은 helpful 이나 note 중 하나 이상", () => {
    expect(AskFeedbackSchema.safeParse({ by: "엄마" }).success).toBe(false);
    expect(AskFeedbackSchema.safeParse({ by: "엄마", helpful: null }).success).toBe(false);
    expect(AskFeedbackSchema.safeParse({ by: "엄마", helpful: false }).success).toBe(true);
  });
});

describe("10단계 정의", () => {
  it("1~10 연속, 제목은 비어 있지 않고 10단계만 alert", () => {
    expect(ASK_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const l of ASK_LEVELS) expect(l.title.length).toBeGreaterThan(0);
    expect(ASK_LEVELS.filter((l) => l.band === "alert").map((l) => l.level)).toEqual([10]);
    expect(levelInfo(5).title).toBe("방법 바꾸며 1주 기록");
  });
});

describe("JSON Schema", () => {
  it("answerJsonSchema 는 draft-7 이고 필수·상한을 담는다", () => {
    const s = answerJsonSchema() as {
      $schema: string;
      required: string[];
      additionalProperties: boolean;
      properties: {
        tryNow: { minItems: number; maxItems: number };
        level: { minimum: number; maximum: number };
      };
    };
    expect(s.$schema).toContain("draft-07");
    expect(s.required).toEqual(
      expect.arrayContaining(["level", "summary", "observe", "upIf", "downIf"]),
    );
    expect(s.required).not.toContain("forAsker");
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.tryNow).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(s.properties.level).toMatchObject({ minimum: 1, maximum: 10 });
  });
});

describe("즉시 결과 낱말", () => {
  it("조사를 떼고 긴 낱말부터 최대 4개", () => {
    expect(questionTokens("간식을 먹을 때 자꾸 던져요 그리고 소리를 질러요")).toEqual(
      expect.arrayContaining(["간식"]),
    );
    expect(questionTokens("a b 12 34 가나다라마바사아자차카타").length).toBeLessThanOrEqual(4);
    expect(questionTokens("  ")).toEqual([]);
    expect(questionTokens("12 345")).toEqual([]);
  });
  it("발췌는 일치 앞 20자부터 70자", () => {
    const body = `${"가".repeat(50)}간식${"나".repeat(100)}`;
    const s = snippetAround(body, ["간식"]);
    expect(s.startsWith("…")).toBe(true);
    expect(s).toContain("간식");
    expect(s.endsWith("…")).toBe(true);
  });
});
