// 답변 스키마의 단일 출처는 shared/ask-schema.ts (서버 검증과 같은 zod). 워커는 검토 출력과 점수 계산만 따로 가진다.
import { z } from "zod";

export { AnswerSchema as answerSchema, type Answer } from "../../shared/ask-schema.ts";

/** 검토자가 지적할 수 있는 종류. 점수는 모델이 아니라 이 목록으로 코드가 계산한다. */
export const ISSUE_CATEGORIES = [
  "factual", // 근거 묶음과 사실이 어긋남
  "ungrounded", // 묶음에 없는 방법·숫자를 「일반 권고」 표시 없이 씀
  "safety", // 안전·연락처 누락, 진단·판정
  "template", // 단계별 틀(개수·관찰 기간) 불일치
  "record_link", // 기록이 질문과 이어지지 않음
  "over_interpretation", // 근거 문장을 넘겨 해석
  "style", // 길이·말투
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/** 항목당 감점(10점에서 뺀다). style 은 총 STYLE_CAP 까지만. */
export const DEDUCTIONS: Record<IssueCategory, number> = {
  factual: 1.0,
  ungrounded: 0.5,
  safety: 0.5,
  template: 0.4,
  record_link: 0.3,
  over_interpretation: 0.3,
  style: 0.1,
};
export const STYLE_CAP = 0.3;

/** 재검토에서 새로 추가할 수 있는 종류(문체 트집 방지). */
export const NEW_ISSUE_CATEGORIES: readonly IssueCategory[] = ["factual", "ungrounded", "safety"];

export const issueSchema = z.strictObject({
  category: z.enum(ISSUE_CATEGORIES),
  where: z.string().max(80),
  fix: z.string().max(200),
});
export type ReviewIssue = z.infer<typeof issueSchema>;

export const reviewSchema = z.strictObject({
  issues: z.array(issueSchema).max(12),
  /** 재검토에서만 의미: 이전 지적(번호 1부터)이 고쳐졌는지. */
  previousStatus: z
    .array(z.strictObject({ index: z.number().int().min(1).max(12), fixed: z.boolean() }))
    .max(12),
});
export type Review = z.infer<typeof reviewSchema>;

// claude --json-schema 에 넘기는 검토 스키마(reviewSchema 와 같은 제약).
export const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues", "previousStatus"],
  properties: {
    issues: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "where", "fix"],
        properties: {
          category: { type: "string", enum: [...ISSUE_CATEGORIES] },
          where: { type: "string", maxLength: 80 },
          fix: { type: "string", maxLength: 200 },
        },
      },
    },
    previousStatus: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "fixed"],
        properties: {
          index: { type: "integer", minimum: 1, maximum: 12 },
          fixed: { type: "boolean" },
        },
      },
    },
  },
} as const;

export function deductionsByCategory(
  issues: readonly ReviewIssue[],
): Record<IssueCategory, number> {
  const out = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c, 0])) as Record<
    IssueCategory,
    number
  >;
  for (const i of issues) out[i.category] += DEDUCTIONS[i.category];
  out.style = Math.min(STYLE_CAP, out.style);
  for (const c of ISSUE_CATEGORIES) out[c] = Math.round(out[c] * 100) / 100;
  return out;
}

/** 점수 = 10 − 감점 합계(0~10, 소수 둘째 자리). 모델이 낸 점수는 쓰지 않는다. */
export function computeScore(issues: readonly ReviewIssue[]): number {
  const d = deductionsByCategory(issues);
  const total = ISSUE_CATEGORIES.reduce((s, c) => s + d[c], 0);
  return Math.round(Math.min(10, Math.max(0, 10 - total)) * 100) / 100;
}

/**
 * 검토 결과를 최종 지적 목록으로 만든다.
 * - 처음 검토(previous 없음): 모델이 낸 지적 전부.
 * - 재검토: 고쳐지지 않은 이전 지적(응답이 없으면 안 고친 것으로 본다) + 새 지적 중 NEW_ISSUE_CATEGORIES 만.
 */
export function mergeReview(
  review: Review,
  previous: readonly ReviewIssue[] | null,
): ReviewIssue[] {
  if (!previous || previous.length === 0) return [...review.issues];
  const fixed = new Set(review.previousStatus.filter((s) => s.fixed).map((s) => s.index));
  const carried = previous.filter((_, i) => !fixed.has(i + 1));
  const fresh = review.issues.filter((i) => NEW_ISSUE_CATEGORIES.includes(i.category));
  return [...carried, ...fresh];
}

export const issueLine = (i: ReviewIssue): string => `[${i.category}] ${i.where}: ${i.fix}`;
