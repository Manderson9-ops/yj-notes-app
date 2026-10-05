import { describe, expect, it } from "vitest";
import {
  computeScore,
  deductionsByCategory,
  mergeReview,
  reviewSchema,
  REVIEW_JSON_SCHEMA,
  type ReviewIssue,
} from "./answer-schema.ts";

const issue = (category: ReviewIssue["category"], where = "x"): ReviewIssue => ({
  category,
  where,
  fix: "고쳐요",
});

describe("점수 계산(코드가 지적 목록에서 계산)", () => {
  it("지적이 없으면 10점", () => {
    expect(computeScore([])).toBe(10);
  });
  it("범주별 고정 감점", () => {
    expect(computeScore([issue("factual")])).toBe(9);
    expect(computeScore([issue("ungrounded")])).toBe(9.5);
    expect(computeScore([issue("safety")])).toBe(9.5);
    expect(computeScore([issue("template")])).toBe(9.6);
    expect(computeScore([issue("record_link")])).toBe(9.7);
    expect(computeScore([issue("over_interpretation")])).toBe(9.7);
    expect(computeScore([issue("style")])).toBe(9.9);
  });
  it("style 은 합쳐서 0.3 까지만 감점한다", () => {
    expect(computeScore(Array.from({ length: 2 }, () => issue("style")))).toBe(9.8);
    expect(computeScore(Array.from({ length: 10 }, () => issue("style")))).toBe(9.7);
  });
  it("합산하고 0~10 으로 자른다", () => {
    expect(computeScore([issue("factual"), issue("ungrounded"), issue("template")])).toBe(8.1);
    expect(computeScore(Array.from({ length: 12 }, () => issue("factual")))).toBe(0);
  });
  it("범주별 감점 표", () => {
    const d = deductionsByCategory([
      issue("factual"),
      issue("style"),
      issue("style"),
      issue("safety"),
    ]);
    expect(d).toMatchObject({ factual: 1, style: 0.2, safety: 0.5, template: 0 });
  });
});

describe("재검토 병합", () => {
  const prev: ReviewIssue[] = [
    issue("ungrounded", "a"),
    issue("template", "b"),
    issue("style", "c"),
  ];
  it("처음 검토는 모델이 낸 지적 전부", () => {
    const r = reviewSchema.parse({
      issues: [issue("style"), issue("record_link")],
      previousStatus: [],
    });
    expect(mergeReview(r, null)).toHaveLength(2);
    expect(mergeReview(r, [])).toHaveLength(2);
  });
  it("고쳐진 이전 지적은 빠지고, 안 고친 것·응답 없는 것은 이어진다", () => {
    const r = reviewSchema.parse({
      issues: [],
      previousStatus: [
        { index: 1, fixed: true },
        { index: 2, fixed: false },
      ],
    });
    // 3번은 응답이 없으니 안 고친 것으로 본다
    expect(mergeReview(r, prev).map((i) => i.where)).toEqual(["b", "c"]);
  });
  it("재검토에서 새로 추가되는 지적은 factual·ungrounded·safety 만(문체 트집 차단)", () => {
    const r = reviewSchema.parse({
      issues: [
        issue("style", "n1"),
        issue("template", "n2"),
        issue("record_link", "n3"),
        issue("over_interpretation", "n4"),
        issue("factual", "n5"),
        issue("ungrounded", "n6"),
        issue("safety", "n7"),
      ],
      previousStatus: prev.map((_, i) => ({ index: i + 1, fixed: true })),
    });
    expect(mergeReview(r, prev).map((i) => i.where)).toEqual(["n5", "n6", "n7"]);
  });
});

describe("검토 스키마", () => {
  it("모르는 범주·긴 where·점수 필드를 거부한다", () => {
    expect(
      reviewSchema.safeParse({
        issues: [{ category: "tone", where: "x", fix: "y" }],
        previousStatus: [],
      }).success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse({
        issues: [{ category: "style", where: "가".repeat(81), fix: "y" }],
        previousStatus: [],
      }).success,
    ).toBe(false);
    expect(reviewSchema.safeParse({ score: 9.9, issues: [], previousStatus: [] }).success).toBe(
      false,
    );
    expect(reviewSchema.safeParse({ issues: [], previousStatus: [] }).success).toBe(true);
  });
  it("CLI 용 JSON Schema 가 같은 범주를 담는다", () => {
    const cats = REVIEW_JSON_SCHEMA.properties.issues.items.properties.category.enum;
    expect(cats).toEqual([
      "factual",
      "ungrounded",
      "safety",
      "template",
      "record_link",
      "over_interpretation",
      "style",
    ]);
    expect(REVIEW_JSON_SCHEMA.required).toEqual(["issues", "previousStatus"]);
  });
});
