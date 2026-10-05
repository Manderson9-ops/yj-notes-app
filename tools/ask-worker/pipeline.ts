// 답변 파이프라인: 근거 묶음 → 작성 → (결정적 검사) → 검토 → (score < 목표면 1회 재작성·재검토).
import {
  answerSchema,
  REVIEW_JSON_SCHEMA,
  reviewSchema,
  type Answer,
  type Review,
} from "./answer-schema.ts";
import { checkAnswer, type PackInfo } from "./checks.ts";
import type { ClaudeRunner } from "./claude.ts";
import { generatePrompt, reviewPrompt, rewritePrompt, type PromptQuestion } from "./prompts.ts";

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
  buildPack: (question: string, signal?: AbortSignal) => Promise<PackInfo & { tokens: number }>;
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
  rubric: Review["rubric"];
  model: string;
  workMs: number;
  rewritten: boolean;
  timings: Record<string, number>;
  packTokens: number;
}

const REVIEW_SCHEMA_JSON = JSON.stringify(REVIEW_JSON_SCHEMA);

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
  const review = async (name: string, pack: string, answer: Answer): Promise<Review> => {
    const r = await stage(name, () =>
      deps.runClaude(
        {
          prompt: reviewPrompt(pack, q, JSON.stringify(answer)),
          systemPromptFile: deps.reviewPromptFile,
          schemaJson: REVIEW_SCHEMA_JSON,
        },
        signal,
      ),
    );
    const parsed = reviewSchema.safeParse(r.output);
    if (!parsed.success) throw new PipelineError("review_invalid");
    return parsed.data;
  };
  const issuesOf = (r: Review): string[] => [
    ...r.issues,
    ...(r.levelConsistent ? [] : ["단계(level)가 기록·근거·판단 축과 맞지 않아요"]),
  ];

  await hooks.onAnswering?.();
  const info = await stage("pack", () => deps.buildPack(q.body, signal));
  const first = checkAnswer(
    await generate("generate", generatePrompt(info.pack, q)),
    info,
    q.redFlag,
  );

  await hooks.onReviewing?.();
  let best: { answer: Answer; review: Review } | null = null;
  let issues: string[] = [...first.issues];
  if (first.ok && first.answer) {
    const r1 = await review("review", info.pack, first.answer);
    best = { answer: first.answer, review: r1 };
    issues = issuesOf(r1);
  }

  let rewritten = false;
  const good = (b: typeof best): boolean =>
    b !== null && b.review.score >= deps.targetScore && b.review.levelConsistent;
  if (!good(best)) {
    rewritten = true;
    const prev = best?.answer ?? first.answer;
    const raw = await generate(
      "rewrite",
      rewritePrompt(
        info.pack,
        q,
        JSON.stringify(prev ?? "(스키마 검증 실패)"),
        issues.length ? issues : ["전체를 다시 작성해요"],
      ),
    );
    const second = checkAnswer(raw, info, q.redFlag);
    if (second.ok && second.answer) {
      const r2 = await review("review2", info.pack, second.answer);
      if (!best || r2.score >= best.review.score) best = { answer: second.answer, review: r2 };
    }
  }

  if (!best) throw new PipelineError("checks_failed");
  if (best.review.score < deps.minPublishScore) throw new PipelineError("low_score");
  const parsed = answerSchema.safeParse(best.answer);
  if (!parsed.success) throw new PipelineError("schema_invalid");
  timings.total = Math.round(now() - t0);
  return {
    level: best.answer.level,
    answer: best.answer,
    reviewScore: Math.round(best.review.score * 10) / 10,
    rubric: best.review.rubric,
    model,
    workMs: timings.total,
    rewritten,
    timings,
    packTokens: info.tokens,
  };
}
