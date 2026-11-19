// 후속 짧은 답 파이프라인(T-Q5): 확장 → 근거 묶음 → 작성 → checkFollowup → 검토(ASK_FOLLOWUP_REVIEW_MODEL)
// → (점수 < 목표면 지적만 고치는 재작성 1회 → 재검토) → 최고 점수 확정. 첫 질문 파이프라인(pipeline.ts)과 같은 점수식을 쓴다.
// 초안 게시는 없다(T-Q4b). 카드 갱신 입력(cardQuestion)도 여기서 만든다.
import {
  computeScore,
  deductionsByCategory,
  issueLine,
  mergeReview,
  REVIEW_JSON_SCHEMA,
  reviewSchema,
  type IssueCategory,
  type ReviewIssue,
} from "./answer-schema.ts";
import { checkFollowup, softToReviewIssues, type CheckIssue, type PackInfo } from "./checks.ts";
import type { ClaimedTurn } from "./client.ts";
import type { ClaudeRequest } from "./claude.ts";
import { buildThreadSection, type ThreadContext } from "./family.ts";
import type { ExpandResult } from "./expand.ts";
import {
  addFamily,
  PipelineError,
  type DraftContext,
  type FollowupConfig,
  type PipelineDeps,
  type PipelineHooks,
} from "./pipeline.ts";
import {
  followupGeneratePrompt,
  followupReviewPrompt,
  followupRewritePrompt,
  QUESTION_TEXT_MAX,
  type PromptQuestion,
} from "./prompts.ts";
import type { Followup } from "../../shared/ask-schema.ts";

export const MAX_FOLLOWUP_REWRITES = 1;

const REVIEW_SCHEMA_JSON = JSON.stringify(REVIEW_JSON_SCHEMA);

/** 짧은 답 파이프라인 훅: 첫 작성본이 Followup 이라는 점만 첫 질문 훅과 다르다. */
export interface FollowupHooks extends Omit<PipelineHooks, "onFirstDraft"> {
  onFirstDraft?: (reply: Followup | null, hard: readonly CheckIssue[], ctx: DraftContext) => void;
}

export interface FollowupResult {
  reply: Followup;
  reviewScore: number;
  deductions: Record<IssueCategory, number>;
  /** 확정된 답에 남은 검토 지적(검토자 + 코드 SOFT). */
  issues: ReviewIssue[];
  model: string;
  workMs: number;
  rewrites: number;
  rewritten: boolean;
  timings: Record<string, number>;
  packTokens: number;
}

// ── claim 응답 → 파이프라인 입력 ───────────────────────────────

/** 근거 묶음·확장 입력 = 「새 턴 본문 + 원 질문」(턴 본문이 없는 reask 턴이면 원 질문만). */
export function expansionText(turnBody: string, originBody: string): string {
  const t = turnBody.trim();
  const joined = t === "" ? originBody : `${t}\n(처음 질문) ${originBody}`;
  return joined.slice(0, 2 * QUESTION_TEXT_MAX);
}

/** claim 의 thread 를 프롬프트 구역 입력으로 바꾼다. 카드 단계면 이 턴이 확정한 짧은 답·갱신 이유를 함께 싣는다. */
export function threadContext(c: ClaimedTurn): ThreadContext {
  const { thread, turn } = c;
  return {
    question: { by: thread.question.askedBy, body: thread.question.body },
    card: thread.card,
    turns: thread.turns.map((t) => ({
      by: t.by,
      body: t.body,
      reply: t.reply,
      kind: t.kind,
      reaskReason: t.reaskReason,
    })),
    ...(c.stage === "card" ? { confirmedReply: turn.reply, cardReason: turn.cardReason } : {}),
  };
}

/** 짧은 답 단계의 질문: 새 턴 본문이 가족 질문 블록이 되고, 대화는 「이전 대화」 구역으로 간다. */
export function replyQuestion(c: ClaimedTurn): PromptQuestion {
  return {
    body: c.turn.body,
    askedBy: c.turn.askedBy,
    redFlag: false,
    id: c.thread.question.id,
    thread: threadContext(c),
  };
}

/**
 * 카드 단계의 질문(카드 파이프라인 answerQuestion 의 입력). redFlag = 턴 위급 OR 질문 잠금(checkAnswer 가 10단계로 막는다),
 * 응급 절은 위급 턴이면 턴 본문, 아니면 원 질문 본문으로 고른다. reask 턴은 지금 reask claim 과 같은 입력(turn.reask)을 쓴다.
 */
export function cardQuestion(c: ClaimedTurn): PromptQuestion {
  const { turn, thread } = c;
  return {
    body: expansionText(turn.body, thread.question.body),
    askedBy: turn.askedBy,
    redFlag: turn.redFlag || c.redLock,
    id: thread.question.id,
    reask: turn.reask,
    thread: threadContext(c),
    emergencyText: turn.redFlag ? turn.body : thread.question.body,
  };
}

/** 검토 호출 요청(운영 검토와 eval --review-only 가 같은 입력을 쓰도록 한 곳에서 만든다). */
export function followupReviewRequest(
  o: Pick<FollowupConfig, "reviewPromptFile" | "reviewModel">,
  pack: string,
  pq: PromptQuestion,
  reply: Followup,
  previous: ReviewIssue[] | null,
): ClaudeRequest {
  return {
    ...(o.reviewModel ? { model: o.reviewModel } : {}),
    prompt: followupReviewPrompt(pack, pq, JSON.stringify(reply), previous),
    systemPromptFile: o.reviewPromptFile,
    schemaJson: REVIEW_SCHEMA_JSON,
  };
}

/** 현재 카드의 단계(단계가 있는 카드일 때만). */
export const cardLevelOf = (pq: PromptQuestion): number | undefined =>
  pq.thread?.card?.kind === "behavior" ? pq.thread.card.level : undefined;

interface Candidate {
  reply: Followup;
  issues: ReviewIssue[];
  reviewer: ReviewIssue[];
  score: number;
}

export async function answerFollowup(
  deps: PipelineDeps,
  c: ClaimedTurn,
  hooks: FollowupHooks = {},
  signal?: AbortSignal,
): Promise<FollowupResult> {
  const cfg = deps.followup;
  if (!cfg) throw new PipelineError("followup_unconfigured");
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
        { prompt, systemPromptFile: cfg.systemPromptFile, schemaJson: cfg.schemaJson },
        signal,
      ),
    );
    model = r.model;
    hooks.onModel?.(name, r.model);
    return r.output;
  };
  let reviewing = false;
  let pq = replyQuestion(c);
  const review = async (
    name: string,
    pack: string,
    reply: Followup,
    previous: ReviewIssue[] | null,
    soft: readonly CheckIssue[],
  ): Promise<Candidate> => {
    if (!reviewing) {
      reviewing = true;
      await hooks.onReviewing?.();
    }
    const r = await stage(name, () =>
      deps.runClaude(followupReviewRequest(cfg, pack, pq, reply, previous), signal),
    );
    hooks.onModel?.(name, r.model);
    const parsed = reviewSchema.safeParse(r.output);
    if (!parsed.success) throw new PipelineError("review_invalid");
    const reviewer = mergeReview(parsed.data, previous);
    const issues = [...reviewer, ...softToReviewIssues(soft)];
    return { reply, issues, reviewer, score: computeScore(issues) };
  };

  await hooks.onAnswering?.();
  const text = expansionText(c.turn.body, c.thread.question.body);
  let exp: ExpandResult | null = null;
  if (deps.expand) {
    const expand = deps.expand;
    exp = await stage("expand", () =>
      expand({ body: text, askedBy: c.turn.askedBy, redFlag: false }, signal),
    );
  }
  const e = exp?.ok ? exp.expansion : undefined;
  pq = { ...pq, isBehavior: e?.isBehaviorQuestion, topic: e?.topic };
  const packed = await stage("pack", () => deps.buildPack(text, signal, e));
  let info: PackInfo & { tokens: number } = {
    ...packed,
    isBehavior: pq.isBehavior,
    domains: e?.domains,
    severity: e
      ? { frequency: e.frequency, duration: e.duration, impact: e.impact, aggression: e.aggression }
      : undefined,
    askedBy: c.turn.askedBy,
    today: deps.today?.(),
  };
  let promptPack = info.pack;
  if (deps.getHistory) {
    ({ promptPack, info } = await addFamily(
      deps,
      { id: c.thread.question.id, body: text },
      e,
      promptPack,
      info,
      stage,
    ));
  }
  const threadSection = buildThreadSection(pq.thread);
  if (threadSection !== "") promptPack = `${promptPack}\n\n${threadSection}`;

  const ctx = { cardLevel: cardLevelOf(pq) };
  const first = checkFollowup(
    await generate("generate", followupGeneratePrompt(promptPack, pq)),
    info,
    ctx,
  );
  hooks.onCheckIssues?.("generate", first.items);
  hooks.onFirstDraft?.(first.reply, first.hard, { promptPack, pq, info });
  let best: Candidate | null = null;
  let fixes: string[] = first.issues;
  let prevReply: Followup | null = first.reply;
  let prevReview: ReviewIssue[] | null = null;
  if (first.reply && first.hard.length === 0) {
    best = await review("review", promptPack, first.reply, null, first.soft);
    if (best.score >= deps.targetScore) return finish(best, 0);
    fixes = best.issues.map(issueLine);
    prevReply = first.reply;
    prevReview = best.reviewer;
  }

  // 재작성(최대 MAX_FOLLOWUP_REWRITES 회): 지적만 고치고 나머지는 그대로
  const raw = await generate(
    "rewrite",
    followupRewritePrompt(
      promptPack,
      pq,
      JSON.stringify(prevReply ?? "(스키마 검증 실패)"),
      fixes.length > 0 ? fixes : ["전체를 다시 작성해요"],
    ),
  );
  const second = checkFollowup(raw, info, ctx);
  hooks.onCheckIssues?.("rewrite", second.items);
  if (second.reply && second.hard.length === 0) {
    const cand = await review("review2", promptPack, second.reply, prevReview, second.soft);
    if (!best || cand.score >= best.score) best = cand;
  }
  if (!best) throw new PipelineError("checks_failed");
  return finish(best, MAX_FOLLOWUP_REWRITES);

  function finish(cand: Candidate, rewrites: number): FollowupResult {
    if (cand.score < deps.minPublishScore) throw new PipelineError("low_score");
    timings.total = Math.round(now() - t0);
    return {
      reply: cand.reply,
      reviewScore: Math.round(cand.score * 10) / 10,
      deductions: deductionsByCategory(cand.issues),
      issues: cand.issues,
      model,
      workMs: timings.total,
      rewrites,
      rewritten: rewrites > 0,
      timings,
      packTokens: info.tokens,
    };
  }
}
