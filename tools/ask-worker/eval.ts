// 골든 세트 평가: npm run ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> [--runs 2] [--limit N] [--save-answers]
// golden.jsonl 한 줄: {"id":"g01","question":"...","askedBy":"..."?,"redFlag":false?}
// 저장소 안 경로는 거부한다. 결과(JSON + markdown)에는 질문·답변 본문을 쓰지 않는다(id·점수·시간·감점 범주만).
// 질문마다 결과 파일을 통째로 다시 쓴다(중간에 멈춰도 그때까지의 결과가 남는다).
// --history <json>: 합성 가족 결과(이전 질문·표·메모)를 주입한다. 형식: HistoryItem[] 또는 {"items": HistoryItem[]} (GET /api/worker/ask/history 응답과 같다).
// --reask <json>: 다시 답변 상황을 주입한다. 형식: {"reason","by","count"?,"previousAnswer"} 이면 모든 문항에, {"<골든 id>": {…}} 이면 그 문항에만.
//   reason 은 「선택지」 또는 「선택지 · 자유 글」(선택지: 너무 일반적이에요 / 이미 해 봤어요 / 우리 상황과 달라요 / 더 자세히 알고 싶어요).
// 두 파일 모두 저장소 밖 경로만 허용한다(결과에는 본문을 쓰지 않는다).
// --save-answers: 독립 검토용으로 답변 본문과 검토 지적(범주·위치·수정안)을 answers-<시각>.json 에 저장한다(S1, 저장소 밖).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ReviewIssue } from "./answer-schema.ts";
import { assertOutsideRepo, loadConfig } from "./config.ts";
import { renderMarkdown, summarize, type EvalItem } from "./eval-stats.ts";
import { parseHistory, parseReask } from "./inject.ts";
import { answerQuestion } from "./pipeline.ts";
import { makePipelineDeps } from "./worker.ts";

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
  /** not_behavior 는 null(워커는 스키마상 1을 보내지만 화면에는 단계가 없다). */
  level: number | null;
  score: number;
  rewrites: number;
  issues: ReviewIssue[];
  answer: unknown;
}

/** 저장용 단계: not_behavior 이면 null. */
export function savedLevel(answer: { kind?: string }, level: number): number | null {
  return answer.kind === "not_behavior" ? null : level;
}

export async function main(args: string[]): Promise<number> {
  const setPath = opt(args, "--set");
  const outDir = opt(args, "--out");
  if (!setPath || !outDir) {
    console.error(
      "사용: ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> [--runs 2] [--limit N] [--save-answers] [--history <json>] [--reask <json>]",
    );
    return 1;
  }
  assertOutsideRepo(setPath);
  assertOutsideRepo(outDir);
  const historyPath = opt(args, "--history");
  const reaskPath = opt(args, "--reask");
  if (historyPath) assertOutsideRepo(historyPath);
  if (reaskPath) assertOutsideRepo(reaskPath);
  const history = historyPath ? parseHistory(readFileSync(historyPath, "utf8")) : null;
  const reaskOf = reaskPath ? parseReask(readFileSync(reaskPath, "utf8")) : () => undefined;
  const cfg = loadConfig({ requireToken: false });
  if (!cfg.dataDir) throw new Error("DATA_DIR 가 필요해요");
  const runs = Math.max(1, Math.min(3, Number(opt(args, "--runs") ?? 2)));
  const limit = Number(opt(args, "--limit") ?? Infinity);
  const saveAnswers = args.includes("--save-answers");
  const saved: SavedAnswer[] = [];
  const golden = parseGolden(readFileSync(setPath, "utf8")).slice(0, limit);
  const deps = makePipelineDeps(
    cfg,
    { dataDir: cfg.dataDir, cacheDir: join(cfg.home, "cache") },
    history ? () => Promise.resolve(history) : undefined,
  );
  const items: EvalItem[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(outDir, { recursive: true });
  const flush = () => {
    const summary = summarize(items);
    writeFileSync(join(outDir, `eval-${stamp}.json`), JSON.stringify({ summary, items }, null, 2));
    writeFileSync(join(outDir, `eval-${stamp}.md`), renderMarkdown(summary, items, stamp));
    if (saveAnswers) {
      writeFileSync(join(outDir, `answers-${stamp}.json`), JSON.stringify(saved, null, 2));
    }
    return summary;
  };
  for (const g of golden) {
    const item: EvalItem = { id: g.id, runs: [] };
    items.push(item);
    for (let n = 0; n < runs; n++) {
      try {
        const r = await answerQuestion(deps, {
          body: g.question,
          askedBy: g.askedBy ?? "가족",
          redFlag: g.redFlag ?? false,
          reask: reaskOf(g.id),
        });
        item.runs.push({
          level: r.level,
          score: r.reviewScore,
          deductions: r.deductions,
          totalMs: r.workMs,
          timings: r.timings,
        });
        if (saveAnswers) {
          saved.push({
            id: g.id,
            run: n,
            level: savedLevel(r.answer, r.level),
            score: r.reviewScore,
            rewrites: r.rewrites,
            issues: r.issues,
            answer: r.answer,
          });
        }
      } catch (e) {
        item.error = e instanceof Error ? e.message.slice(0, 40) : "error";
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : "평가 오류");
      process.exit(1);
    },
  );
}
