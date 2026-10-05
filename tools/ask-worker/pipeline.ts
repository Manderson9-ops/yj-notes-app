// 답변 파이프라인: 근거 묶음 → 작성 → 결정적 검사 → 검토 → (점수 < 목표면 지적만 고치는 재작성 1회 → 재검토) → 최고 점수 게시.
// 점수는 검토자가 낸 지적 목록에서 코드가 계산한다(answer-schema.ts computeScore).
import {
  computeScore,
  deductionsByCategory,
  issueLine,
  mergeReview,
  REVIEW_JSON_SCHEMA,
  reviewSchema,
  type Answer,
  type IssueCategory,
  type ReviewIssue,
} from "./answer-schema.ts";
import { checkAnswer, type PackInfo } from "./checks.ts";
import type { ClaudeRunner } from "./claude.ts";
import { detectRedFlag } from "../../server/ask/redflags.ts";
import { buildEmergencySection } from "./emergency.ts";
import type { Expansion, ExpandResult } from "./expand.ts";
import { generatePrompt, reviewPrompt, rewritePrompt, type PromptQuestion } from "./prompts.ts";

export const MAX_REWRITES = 1;

export class PipelineError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PipelineError";
    this.code = code;
  }
}

export interface PipelineDeps {
  runClaude: ClaudeRunner;
  buildPack: (
    question: string,
    signal?: AbortSignal,
    expansion?: Expansion,
  ) => Promise<PackInfo & { tokens: number }>;
  /** 질문 확장(빠른 모델). 없으면 건너뛴다. */
  expand?: (q: PromptQuestion, signal?: AbortSignal) => Promise<ExpandResult>;
  /** prompts/emergency.md 본문. 있으면 위급 질문에 맞는 절을 묶음에 붙인다. */
  emergencyMd?: string;
  systemPromptFile: string;
  reviewPromptFile: string; // 검토 호출용 시스템 프롬프트(규칙 문서)
  answerSchemaJson: string;
  targetScore: number;
  minPublishScore: number;
  now?: () => number;
}

export interface PipelineHooks {
  onAnswering?: () => Promise<void> | void;
  onReviewing?: () => Promise<void> | void;
  onStage?: (stage: string, ms: number) => void;
}

export interface PipelineResult {
  level: number;
  answer: Answer;
  reviewScore: number;
  deductions: Record<IssueCategory, number>;
  /** 게시된 답에 남은 검토 지적(--save-answers 에서 저장). */
  issues: ReviewIssue[];
  model: string;
  workMs: number;
  rewrites: number;
  rewritten: boolean;
  timings: Record<string, number>;
  packTokens: number;
}

const REVIEW_SCHEMA_JSON = JSON.stringify(REVIEW_JSON_SCHEMA);

interface Candidate {
  answer: Answer;
  issues: ReviewIssue[];
  score: number;
}

export async function answerQuestion(
  deps: PipelineDeps,
  q: PromptQuestion,
  hooks: PipelineHooks = {},
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const timings: Record<string, number> = {};
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = now();
    try {
      return await fn();
    } finally {
      timings[name] = Math.round(now() - s);
      hooks.onStage?.(name, timings[name]);
    }
  };
  let model = "opus";

  const generate = async (name: string, prompt: string): Promise<unknown> => {
    const r = await stage(name, () =>
      deps.runClaude(
        { prompt, systemPromptFile: deps.systemPromptFile, schemaJson: deps.answerSchemaJson },
        signal,
      ),
    );
    model = r.model;
    return r.output;
  };
  let reviewing = false;
  const review = async (
    name: string,
    pack: string,
    answer: Answer,
    previous: ReviewIssue[] | null,
  ): Promise<Candidate> => {
    if (!reviewing) {
      reviewing = true;
      await hooks.onReviewing?.();
    }
    const r = await stage(name, () =>
      deps.runClaude(
        {
          prompt: reviewPrompt(pack, pq, JSON.stringify(answer), previous),
          systemPromptFile: deps.reviewPromptFile,
          schemaJson: REVIEW_SCHEMA_JSON,
        },
        signal,
      ),
    );
    const parsed = reviewSchema.safeParse(r.output);
    if (!parsed.success) throw new PipelineError("review_invalid");
    const issues = mergeReview(parsed.data, previous);
    return { answer, issues, score: computeScore(issues) };
  };

  await hooks.onAnswering?.();
  let exp: ExpandResult | null = null;
  if (deps.expand) {
    const expand = deps.expand;
    exp = await stage("expand", () => expand(q, signal));
  }
  const pq: PromptQuestion = {
    ...q,
    isBehavior: exp?.ok ? exp.expansion.isBehaviorQuestion : undefined,
    topic: exp?.ok ? exp.expansion.topic : undefined,
  };
  const packed = await stage("pack", () =>
    deps.buildPack(q.body, signal, exp?.ok ? exp.expansion : undefined),
  );
  let info: PackInfo & { tokens: number } = { ...packed, isBehavior: pq.isBehavior };
  if (q.redFlag && deps.emergencyMd) {
    const em = buildEmergencySection(deps.emergencyMd, detectRedFlag(q.body).rules);
    info = { ...info, pack: `${info.pack}\n${em.text}`, refs: [...info.refs, ...em.refs] };
  }

  const first = checkAnswer(
    await generate("generate", generatePrompt(info.pack, pq)),
    info,
    q.redFlag,
  );
  let best: Candidate | null = null;
  let fixes: string[] = first.issues;
  let prevAnswer: Answer | null = first.answer;
  let prevReview: ReviewIssue[] | null = null;
  if (first.ok && first.answer) {
    best = await review("review", info.pack, first.answer, null);
    if (best.score >= deps.targetScore) return finish(best, 0);
    fixes = best.issues.map(issueLine);
    prevAnswer = first.answer;
    prevReview = best.issues;
  }

  // 재작성(최대 MAX_REWRITES 회): 지적만 고치고 나머지는 그대로
  const raw = await generate(
    "rewrite",
    rewritePrompt(
      info.pack,
      pq,
      JSON.stringify(prevAnswer ?? "(스키마 검증 실패)"),
      fixes.length > 0 ? fixes : ["전체를 다시 작성해요"],
    ),
  );
  const second = checkAnswer(raw, info, q.redFlag);
  if (second.ok && second.answer) {
    const cand = await review("review2", info.pack, second.answer, prevReview);
    if (!best || cand.score >= best.score) best = cand;
  }
  if (!best) throw new PipelineError("checks_failed");
  return finish(best, 1);

  function finish(c: Candidate, rewrites: number): PipelineResult {
    if (c.score < deps.minPublishScore) throw new PipelineError("low_score");
    timings.total = Math.round(now() - t0);
    return {
      level: c.answer.level,
      answer: c.answer,
      reviewScore: Math.round(c.score * 10) / 10,
      deductions: deductionsByCategory(c.issues),
      issues: c.issues,
      model,
      workMs: timings.total,
      rewrites,
      rewritten: rewrites > 0,
      timings,
      packTokens: info.tokens,
    };
  }
}
