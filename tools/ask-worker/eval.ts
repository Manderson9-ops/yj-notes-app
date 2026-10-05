// 골든 세트 평가: npm run ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> [--runs 2] [--limit N]
// golden.jsonl 한 줄: {"id":"g01","question":"...","askedBy":"..."?,"redFlag":false?}
// 저장소 안 경로는 거부한다. 결과(JSON + markdown)에는 질문·답변 본문을 쓰지 않는다(id·점수·시간만).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { answerQuestion } from "./pipeline.ts";
import { assertOutsideRepo, loadConfig } from "./config.ts";
import { renderMarkdown, summarize, type EvalItem } from "./eval-stats.ts";
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

export async function main(args: string[]): Promise<number> {
  const setPath = opt(args, "--set");
  const outDir = opt(args, "--out");
  if (!setPath || !outDir) {
    console.error(
      "사용: ask-worker:eval -- --set <golden.jsonl> --out <결과 폴더> [--runs 2] [--limit N]",
    );
    return 1;
  }
  assertOutsideRepo(setPath);
  assertOutsideRepo(outDir);
  const cfg = loadConfig({ requireToken: false });
  if (!cfg.dataDir) throw new Error("DATA_DIR 가 필요해요");
  const runs = Math.max(1, Math.min(3, Number(opt(args, "--runs") ?? 2)));
  const limit = Number(opt(args, "--limit") ?? Infinity);
  const golden = parseGolden(readFileSync(setPath, "utf8")).slice(0, limit);
  const deps = makePipelineDeps(cfg, { dataDir: cfg.dataDir, cacheDir: join(cfg.home, "cache") });
  const items: EvalItem[] = [];
  for (const g of golden) {
    const item: EvalItem = { id: g.id, runs: [] };
    for (let n = 0; n < runs; n++) {
      try {
        const r = await answerQuestion(deps, {
          body: g.question,
          askedBy: g.askedBy ?? "가족",
          redFlag: g.redFlag ?? false,
        });
        item.runs.push({
          level: r.level,
          score: r.reviewScore,
          rubric: r.rubric,
          totalMs: r.workMs,
        });
      } catch (e) {
        item.error = e instanceof Error ? e.message.slice(0, 40) : "error";
        break;
      }
    }
    console.log(
      `${g.id}: ${item.error ? `실패 ${item.error}` : item.runs.map((r) => `L${r.level}/${r.score}`).join(" ")}`,
    );
    items.push(item);
  }
  const summary = summarize(items);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `eval-${stamp}.json`), JSON.stringify({ summary, items }, null, 2));
  writeFileSync(join(outDir, `eval-${stamp}.md`), renderMarkdown(summary, items, stamp));
  console.log(
    `평균 ${summary.avgScore}, 최저 ${summary.minScore}, 단계 일관성 ${summary.levelConsistent}/${summary.levelChecked}`,
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
