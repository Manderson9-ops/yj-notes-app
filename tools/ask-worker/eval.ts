// 골든 세트 평가: npm run ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> [--runs 2] [--limit N] [--save-answers] [--review-model <모델>]
// golden.jsonl 한 줄: {"id":"g01","question":"...","askedBy":"..."?,"redFlag":false?}
// 저장소 안 경로는 거부한다. 결과(JSON + markdown)에는 질문·답변 본문을 쓰지 않는다(id·점수·시간·감점 범주·모델 ID만).
// 질문마다 결과 파일을 통째로 다시 쓴다(중간에 멈춰도 그때까지의 결과가 남는다).
// 오류는 「단계:코드」(예: review:claude_exit — 파이프라인 진행 훅의 마지막 단계)로 남긴다.
// --history <json>: 합성 가족 결과(이전 질문·표·메모)를 주입한다. 형식: HistoryItem[] 또는 {"items": HistoryItem[]} (GET /api/worker/ask/history 응답과 같다).
// --reask <json>: 다시 답변 상황을 주입한다. 형식: {"reason","by","count"?,"previousAnswer"} 이면 모든 문항에, {"<골든 id>": {…}} 이면 그 문항에만.
//   reason 은 「선택지」 또는 「선택지 · 자유 글」(선택지: 너무 일반적이에요 / 이미 해 봤어요 / 우리 상황과 달라요 / 더 자세히 알고 싶어요).
// 두 파일 모두 저장소 밖 경로만 허용한다(결과에는 본문을 쓰지 않는다).
// --review-model <모델>: 이 실행의 review·review2 가 worker.env 의 ASK_REVIEW_MODEL 대신 이 모델을 쓴다(운영 설정을 바꾸지 않고 비교).
// --save-answers: answers-<시각>.json(형식 2)에 문항·run 마다 첫 작성본(stage "first", 검토 전 — 예외로 끝나도 저장)과
//   최종 답(stage "final")을 검토 입력(근거 묶음 promptPack·질문 정보 pq·검사 정보 info)과 함께 저장한다.
//   묶음에는 가족 기록이 들어가므로 저장소 밖(<DATA_DIR>/ask-eval/)에만 둔다.
// 검토만: npm run ask-worker:eval -- --review-only <answers 파일 또는 그것 하나만 든 폴더> --out <결과 폴더> [--review-model <모델>] [--score]
//   저장된 답마다 운영과 같은 입력으로 검토 단계 하나만 돌려 답별 범주별 지적 수(검토자 지적만)를 review-<시각>.json 에 낸다.
//   기본은 첫 작성본(게이트 2). --score 면 최종 답에 검토자 지적 + 코드 SOFT 항목으로 운영과 같은 점수식의 점수를 내고 평균한다(C7 ②).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  answerSchema,
  computeScore,
  ISSUE_CATEGORIES,
  mergeReview,
  reviewSchema,
  type IssueCategory,
  type ReviewIssue,
} from "./answer-schema.ts";
import { checkAnswer, type PackInfo } from "./checks.ts";
import { ClaudeError, claudeVersion, type ClaudeRunner } from "./claude.ts";
import { assertOutsideRepo, isModelName, loadConfig, type WorkerConfig } from "./config.ts";
import { renderMarkdown, resolveResultFile, summarize, type EvalItem } from "./eval-stats.ts";
import { parseHistory, parseReask } from "./inject.ts";
import { PackError } from "./pack.ts";
import {
  answerQuestion,
  PipelineError,
  reviewRequest,
  scoreIssues,
  type DraftContext,
  type PipelineDeps,
  type PipelineHooks,
} from "./pipeline.ts";
import { REVIEW_PROMPT_FILE, type PromptQuestion } from "./prompts.ts";
import { makeClaudeRunner, makePipelineDeps } from "./worker.ts";

const lineSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(1).max(1000),
  askedBy: z.string().max(20).optional(),
  redFlag: z.boolean().optional(),
});

export function parseGolden(text: string) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => lineSchema.parse(JSON.parse(l)));
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export interface SavedAnswer {
  id: string;
  run: number;
  /** first = 첫 작성본(검토 전, HARD 0건), final = 게시될 최종 답. */
  stage: "first" | "final";
  /** not_behavior 는 null(워커는 스키마상 1을 보내지만 화면에는 단계가 없다). */
  level: number | null;
  /** final 만: 게시 점수·재작성 수·남은 지적(검토자 + 코드 SOFT). */
  score?: number;
  rewrites?: number;
  issues?: ReviewIssue[];
  answer: unknown;
  /** 검토 프롬프트에 들어간 근거 묶음(가족 기록 포함 — 저장소 밖에만). */
  promptPack: string;
  pq: PromptQuestion;
  /** SOFT 항목을 만드는 checkAnswer(raw, info, redFlag) 의 입력. */
  info: PackInfo & { tokens: number };
}

export interface SavedAnswersFile {
  format: 2;
  claudeVersion: string;
  reviewModel: string;
  entries: SavedAnswer[];
  /** 첫 작성이 HARD(또는 스키마 실패)라 운영에서 초안이 되지 않는 문항·run — 게이트 2 에서 뺀다. */
  noFirstDraft: { id: string; run: number }[];
}

/** 저장용 단계: not_behavior 이면 null. */
export function savedLevel(answer: { kind?: string }, level: number): number | null {
  return answer.kind === "not_behavior" ? null : level;
}

/** 오류 꼬리표: 「마지막 단계:코드」(단계가 없으면 코드만). 코드는 앞 40자. */
export function errorTag(stage: string, e: unknown): string {
  const code =
    e instanceof ClaudeError || e instanceof PipelineError || e instanceof PackError
      ? e.code
      : e instanceof Error
        ? e.message
        : "error";
  return stage ? `${stage}:${code.slice(0, 40)}` : code.slice(0, 40);
}

const savedEntrySchema = z.object({
  id: z.string(),
  run: z.number(),
  stage: z.enum(["first", "final"]),
  answer: z.unknown(),
  promptPack: z.string(),
  pq: z.custom<PromptQuestion>(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as Record<string, unknown>).body === "string" &&
      typeof (v as Record<string, unknown>).redFlag === "boolean",
  ),
  info: z.custom<PackInfo & { tokens: number }>(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as Record<string, unknown>).pack === "string" &&
      Array.isArray((v as Record<string, unknown>).refs),
  ),
});

/** --review-only 입력: 형식 2(T-Q4a 이후 --save-answers)만 받는다. */
export function parseSavedAnswers(text: string): z.infer<typeof savedEntrySchema>[] {
  const j: unknown = JSON.parse(text);
  if (!j || typeof j !== "object" || (j as { format?: unknown }).format !== 2) {
    throw new Error("저장 답 형식 2 가 아니에요(T-Q4a 이전 --save-answers 파일은 쓸 수 없어요)");
  }
  return z.array(savedEntrySchema).parse((j as { entries?: unknown }).entries);
}

export interface ReviewOnlyRow {
  id: string;
  run: number;
  /** 검토자 실제 모델 ID. */
  model?: string;
  /** 범주별 검토자 지적 수(코드 SOFT 항목은 넣지 않는다). */
  counts?: Record<IssueCategory, number>;
  /** --score 일 때: 검토자 지적 + 코드 SOFT 항목으로 운영 점수식 점수. */
  score?: number;
  error?: string;
}

export function countByCategory(issues: readonly ReviewIssue[]): Record<IssueCategory, number> {
  const out = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c, 0])) as Record<
    IssueCategory,
    number
  >;
  for (const i of issues) out[i.category] += 1;
  return out;
}

export function summarizeReviewOnly(rows: readonly ReviewOnlyRow[], score: boolean) {
  const ok = rows.filter((r) => !r.error);
  const issueCounts = countByCategory([]);
  for (const r of ok) for (const c of ISSUE_CATEGORIES) issueCounts[c] += r.counts?.[c] ?? 0;
  const scores = ok.map((r) => r.score).filter((x): x is number => typeof x === "number");
  return {
    answers: rows.length,
    reviewed: ok.length,
    /** 검토(채점) 호출이 실패한 답 수 — 평균에서 뺀다. */
    failed: rows.length - ok.length,
    issueTotal: ISSUE_CATEGORIES.reduce((s, c) => s + issueCounts[c], 0),
    issueCounts,
    ...(score
      ? {
          avgScore: scores.length
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : null,
        }
      : {}),
  };
}

/** 시험용 주입(가짜 claude·합성 묶음·설정). 운영 실행은 비워 둔다. */
export interface EvalIo {
  cfg?: WorkerConfig;
  /** 전체 실행의 파이프라인 의존성(없으면 makePipelineDeps). */
  deps?: PipelineDeps;
  /** --review-only 의 검토 러너(없으면 운영과 같은 makeClaudeRunner). */
  runClaude?: ClaudeRunner;
  claudeVersion?: string;
  now?: () => Date;
}

const USAGE = [
  "사용: ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> [--runs 2] [--limit N] [--save-answers] [--review-model <모델>] [--history <json>] [--reask <json>]",
  "      ask-worker:eval -- --review-only <answers 파일|폴더> --out <결과 폴더> [--review-model <모델>] [--score]",
].join("\n");

export async function main(args: string[], io: EvalIo = {}): Promise<number> {
  const outDir = opt(args, "--out");
  const reviewOnly = opt(args, "--review-only");
  const setPath = opt(args, "--set");
  const reviewModelOpt = opt(args, "--review-model");
  if (!outDir || (!reviewOnly && !setPath) || (reviewModelOpt && !isModelName(reviewModelOpt))) {
    console.error(USAGE);
    return 1;
  }
  assertOutsideRepo(outDir);
  const cfg = io.cfg ?? loadConfig({ requireToken: false });
  const reviewModel = reviewModelOpt ?? cfg.reviewModel;
  const version = io.claudeVersion ?? claudeVersion(cfg.claudeBin);
  const stamp = (io.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  mkdirSync(outDir, { recursive: true });
  if (reviewOnly) {
    return await runReviewOnly(args, reviewOnly, outDir, { cfg, io, reviewModel, version, stamp });
  }
  return await runFull(args, setPath ?? "", outDir, { cfg, io, reviewModel, version, stamp });
}

interface RunCtx {
  cfg: WorkerConfig;
  io: EvalIo;
  reviewModel: string;
  version: string;
  stamp: string;
}

async function runFull(args: string[], setPath: string, outDir: string, c: RunCtx) {
  assertOutsideRepo(setPath);
  const historyPath = opt(args, "--history");
  const reaskPath = opt(args, "--reask");
  if (historyPath) assertOutsideRepo(historyPath);
  if (reaskPath) assertOutsideRepo(reaskPath);
  const history = historyPath ? parseHistory(readFileSync(historyPath, "utf8")) : null;
  const reaskOf = reaskPath ? parseReask(readFileSync(reaskPath, "utf8")) : () => undefined;
  if (!c.io.deps && !c.cfg.dataDir) throw new Error("DATA_DIR 가 필요해요");
  const runs = Math.max(1, Math.min(3, Number(opt(args, "--runs") ?? 2)));
  const limit = Number(opt(args, "--limit") ?? Infinity);
  const saveAnswers = args.includes("--save-answers");
  const saved: SavedAnswersFile = {
    format: 2,
    claudeVersion: c.version,
    reviewModel: c.reviewModel,
    entries: [],
    noFirstDraft: [],
  };
  const golden = parseGolden(readFileSync(setPath, "utf8")).slice(0, limit);
  const base =
    c.io.deps ??
    makePipelineDeps(
      c.cfg,
      { dataDir: c.cfg.dataDir, cacheDir: join(c.cfg.home, "cache") },
      history ? () => Promise.resolve(history) : undefined,
    );
  const deps: PipelineDeps = { ...base, reviewModel: c.reviewModel };
  const items: EvalItem[] = [];
  const head = { claudeVersion: c.version, reviewModel: c.reviewModel };
  const flush = () => {
    const summary = summarize(items);
    writeFileSync(
      join(outDir, `eval-${c.stamp}.json`),
      JSON.stringify({ ...head, summary, items }, null, 2),
    );
    writeFileSync(join(outDir, `eval-${c.stamp}.md`), renderMarkdown(summary, items, c.stamp));
    if (saveAnswers) {
      writeFileSync(join(outDir, `answers-${c.stamp}.json`), JSON.stringify(saved, null, 2));
    }
    return summary;
  };
  for (const g of golden) {
    const item: EvalItem = { id: g.id, runs: [] };
    items.push(item);
    for (let n = 0; n < runs; n++) {
      // 훅이 채우는 값(클로저 안에서 바뀌므로 객체에 둔다)
      const st: { stage: string; ctx?: DraftContext } = { stage: "" };
      const models: Record<string, string> = {};
      const hooks: PipelineHooks = {
        onStage: (s) => {
          st.stage = s;
        },
        onModel: (s, m) => {
          models[s] = m;
        },
        onFirstDraft: (answer, hard, ctx) => {
          st.ctx = ctx;
          if (!saveAnswers) return;
          if (answer && hard.length === 0) {
            saved.entries.push({
              id: g.id,
              run: n,
              stage: "first",
              level: savedLevel(answer, answer.level),
              answer,
              ...ctx,
            });
          } else saved.noFirstDraft.push({ id: g.id, run: n });
        },
      };
      try {
        const r = await answerQuestion(
          deps,
          {
            body: g.question,
            askedBy: g.askedBy ?? "가족",
            redFlag: g.redFlag ?? false,
            reask: reaskOf(g.id),
          },
          hooks,
        );
        item.runs.push({
          level: r.level,
          score: r.reviewScore,
          deductions: r.deductions,
          totalMs: r.workMs,
          timings: r.timings,
          models,
        });
        if (saveAnswers && st.ctx) {
          saved.entries.push({
            id: g.id,
            run: n,
            stage: "final",
            level: savedLevel(r.answer, r.level),
            score: r.reviewScore,
            rewrites: r.rewrites,
            issues: r.issues,
            answer: r.answer,
            ...st.ctx,
          });
        }
      } catch (e) {
        item.error = errorTag(st.stage, e);
        break;
      }
    }
    console.log(
      `${g.id}: ${item.error ? `실패 ${item.error}` : item.runs.map((r) => `L${String(r.level)}/${String(r.score)}`).join(" ")}`,
    );
    flush();
  }
  const summary = flush();
  console.log(
    `평균 ${String(summary.avgScore)}, 최저 ${String(summary.minScore)}, 단계 일관성 ${String(summary.levelConsistent)}/${String(summary.levelChecked)}`,
  );
  console.log(`결과 저장: ${outDir}`);
  return 0;
}

async function runReviewOnly(args: string[], src: string, outDir: string, c: RunCtx) {
  assertOutsideRepo(src);
  const file = resolveResultFile(src, "answers-");
  const score = args.includes("--score");
  const stage = score ? "final" : "first";
  const entries = parseSavedAnswers(readFileSync(file, "utf8")).filter((e) => e.stage === stage);
  const run = c.io.runClaude ?? makeClaudeRunner(c.cfg);
  const rows: ReviewOnlyRow[] = [];
  const out = join(outDir, `review-${c.stamp}.json`);
  const flush = () => {
    const summary = summarizeReviewOnly(rows, score);
    writeFileSync(
      out,
      JSON.stringify(
        {
          mode: "review-only",
          stage,
          score,
          reviewModel: c.reviewModel,
          claudeVersion: c.version,
          source: basename(file),
          summary,
          entries: rows,
        },
        null,
        2,
      ),
    );
    return summary;
  };
  for (const e of entries) {
    try {
      const answer = answerSchema.parse(e.answer);
      // 운영 첫 검토와 같은 입력(앞 검토 없음). 근거 묶음은 다시 만들지 않는다.
      const r = await run(
        reviewRequest(
          { reviewPromptFile: REVIEW_PROMPT_FILE, reviewModel: c.reviewModel },
          e.promptPack,
          e.pq,
          answer,
          null,
        ),
      );
      const parsed = reviewSchema.safeParse(r.output);
      if (!parsed.success) throw new PipelineError("review_invalid");
      const reviewer = mergeReview(parsed.data, null);
      const row: ReviewOnlyRow = {
        id: e.id,
        run: e.run,
        model: r.model,
        counts: countByCategory(reviewer),
      };
      if (score) {
        const soft = checkAnswer(answer, e.info, e.pq.redFlag).soft;
        row.score = computeScore(scoreIssues(reviewer, soft));
      }
      rows.push(row);
    } catch (err) {
      rows.push({ id: e.id, run: e.run, error: errorTag("review", err) });
    }
    flush();
  }
  const s = flush();
  console.log(
    `검토 ${String(s.reviewed)}/${String(s.answers)} (실패 ${String(s.failed)}), 지적 ${String(s.issueTotal)}건${
      "avgScore" in s ? `, 평균 점수 ${String(s.avgScore)}` : ""
    }`,
  );
  console.log(`결과 저장: ${out}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : "평가 오류");
      process.exit(1);
    },
  );
}
