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
import { checkAnswer, softToReviewIssues, type CheckIssue, type PackInfo } from "./checks.ts";
import { suggestLevel } from "./level-suggest.ts";
import type { ClaudeRunner } from "./claude.ts";
import { detectRedFlag } from "../../server/ask/redflags.ts";
import { buildEmergencySection } from "./emergency.ts";
import {
  buildFamilySection,
  buildReaskSection,
  familyInfo,
  pickFamily,
  reaskInfo,
  selectRelated,
} from "./family.ts";
import type { HistoryItem } from "../../shared/ask-schema.ts";
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
  /** 오늘 날짜 YYYY-MM-DD(없으면 오래된 기록 검사를 건너뛴다). */
  today?: () => string;
  buildPack: (
    question: string,
    signal?: AbortSignal,
    expansion?: Expansion,
  ) => Promise<PackInfo & { tokens: number }>;
  /** 질문 확장(빠른 모델). 없으면 건너뛴다. */
  expand?: (q: PromptQuestion, signal?: AbortSignal) => Promise<ExpandResult>;
  /** 가족 의견(최근 끝난 질문·표·메모). 없거나 실패하면 가족 결과 없이 계속한다. */
  getHistory?: () => Promise<HistoryItem[]>;
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
  /** 결정적 검사 지적(진단용). 질문·답 본문은 넘기지 않는다. */
  onCheckIssues?: (stage: string, issues: CheckIssue[]) => void;
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
  /** 게시 점수의 근거: 검토자 지적 + 코드 쪽 SOFT 지적(같은 감점표). */
  issues: ReviewIssue[];
  /** 검토자가 낸 지적만(재검토의 이전 지적으로 쓴다). */
  reviewer: ReviewIssue[];
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
    soft: readonly CheckIssue[],
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
    const reviewer = mergeReview(parsed.data, previous);
    const issues = [...reviewer, ...softToReviewIssues(soft)];
    return { answer, issues, reviewer, score: computeScore(issues) };
  };

  await hooks.onAnswering?.();
  let exp: ExpandResult | null = null;
  if (deps.expand) {
    const expand = deps.expand;
    exp = await stage("expand", () => expand(q, signal));
  }
  const sevOf = exp?.ok
    ? {
        frequency: exp.expansion.frequency,
        duration: exp.expansion.duration,
        impact: exp.expansion.impact,
        aggression: exp.expansion.aggression,
      }
    : undefined;
  const pq: PromptQuestion = {
    ...q,
    suggested: q.redFlag
      ? undefined
      : suggestLevel(q.body, sevOf, exp?.ok ? exp.expansion.domains : []),
    isBehavior: exp?.ok ? exp.expansion.isBehaviorQuestion : undefined,
    topic: exp?.ok ? exp.expansion.topic : undefined,
  };
  const packed = await stage("pack", () =>
    deps.buildPack(q.body, signal, exp?.ok ? exp.expansion : undefined),
  );
  const e = exp?.ok ? exp.expansion : undefined;
  let info: PackInfo & { tokens: number } = {
    ...packed,
    isBehavior: pq.isBehavior,
    domains: e?.domains,
    severity: e
      ? { frequency: e.frequency, duration: e.duration, impact: e.impact, aggression: e.aggression }
      : undefined,
    askedBy: q.askedBy,
    suggested: pq.suggested,
    today: deps.today?.(),
  };
  if (q.redFlag && deps.emergencyMd) {
    const em = buildEmergencySection(deps.emergencyMd, detectRedFlag(q.body).rules);
    info = { ...info, pack: `${info.pack}\n${em.text}`, refs: [...info.refs, ...em.refs] };
  }

  // 가족 의견: 관련 이전 질문(최대 3)과 다시 답변 요청을 묶음에 덧붙인다. 날짜·작성자 대조(info.pack)는 기록 묶음만으로 한다.
  let promptPack = info.pack;
  if (deps.getHistory && !q.redFlag) {
    const getHistory = deps.getHistory;
    let hist: HistoryItem[] = [];
    try {
      hist = await stage("history", () => getHistory());
    } catch {
      hist = [];
    }
    const nowMs = Date.parse(deps.today?.() ?? "") || Date.now();
    const picks = pickFamily(
      selectRelated(
        hist,
        {
          id: q.id,
          body: q.body,
          keywords: e ? [...e.keywords, ...e.synonyms] : [],
          domains: e?.domains ?? [],
        },
        nowMs,
      ),
    );
    const section = buildFamilySection(picks);
    if (section !== "") {
      const fam = familyInfo(picks);
      promptPack = `${promptPack}\n\n${section}`;
      info = { ...info, refs: [...info.refs, ...fam.refs], family: fam };
    }
  }
  const reaskSection = buildReaskSection(q.reask);
  if (reaskSection !== "") {
    promptPack = `${promptPack}\n\n${reaskSection}`;
    info = { ...info, reask: reaskInfo(q.reask) };
  }

  const first = checkAnswer(
    await generate("generate", generatePrompt(promptPack, pq)),
    info,
    q.redFlag,
  );
  hooks.onCheckIssues?.("generate", first.items);
  let best: Candidate | null = null;
  let fixes: string[] = first.issues;
  let prevAnswer: Answer | null = first.answer;
  let prevReview: ReviewIssue[] | null = null;
  // 첫 초안이 HARD 지적 없이 파싱되면 SOFT 지적이 있어도 검토한다(SOFT 는 막지 않고 감점으로 넘어간다).
  if (first.answer && first.hard.length === 0) {
    best = await review("review", promptPack, first.answer, null, first.soft);
    if (best.score >= deps.targetScore) return finish(best, 0);
    fixes = best.issues.map(issueLine);
    prevAnswer = first.answer;
    prevReview = best.reviewer;
  }

  // 재작성(최대 MAX_REWRITES 회): 지적만 고치고 나머지는 그대로
  const raw = await generate(
    "rewrite",
    rewritePrompt(
      promptPack,
      pq,
      JSON.stringify(prevAnswer ?? "(스키마 검증 실패)"),
      fixes.length > 0 ? fixes : ["전체를 다시 작성해요"],
    ),
  );
  const second = checkAnswer(raw, info, q.redFlag);
  hooks.onCheckIssues?.("rewrite", second.items);
  if (second.answer && second.hard.length === 0) {
    const cand = await review("review2", promptPack, second.answer, prevReview, second.soft);
    if (!best || cand.score >= best.score) best = cand;
  }
  // HARD 지적이 재작성 뒤에도 남았고 첫 초안도 HARD 였을 때만 실패. 첫 초안이 깨끗했으면 그쪽을 게시한다.
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
