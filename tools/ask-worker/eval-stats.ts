// 골든 세트 평가 통계(순수 함수) — 질문 본문·답변 본문은 담지 않는다(id·숫자·범주만).
// 비교 모드(S3 게이트 1·C7 ②): node tools/ask-worker/eval-stats.ts --compare <결과 A> <결과 B> [--set <golden.jsonl>]
//   결과 = eval-<시각>.json 파일 또는 그것 하나만 든 폴더. 두 실행 모두 오류 없이 끝난 문항의 교집합으로
//   평균·단계 일관성 비율을 내고, 실행별 오류 수(ⓐ 검토 단계 · ⓑ low_score · ⓒ unreviewed, 문항 수)와
//   작성 단계 오류 수를 따로 낸다. --set 이 있으면 각 결과의 문항 id 집합이 그 세트와 같은지도 본다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ISSUE_CATEGORIES, type IssueCategory } from "./answer-schema.ts";

export type Deductions = Record<IssueCategory, number>;

export interface EvalRun {
  level: number;
  score: number;
  /** 지적 범주별 감점 */
  deductions: Deductions;
  totalMs: number;
  /** 단계별 시간(ms): expand, pack, generate, review, rewrite, review2, total */
  timings?: Record<string, number>;
  /** claude 호출 단계별 실제 모델 ID(generate·review·rewrite·review2). */
  models?: Record<string, string>;
}

export interface EvalItem {
  id: string;
  runs: EvalRun[]; // 같은 질문 2회
  /** 「단계:코드」(예: review:claude_exit). 단계 꼬리표가 없는 옛 결과는 코드만. */
  error?: string;
}

export interface EvalSummary {
  questions: number;
  failed: string[];
  avgScore: number;
  minScore: number;
  /** 지적 범주별 평균 감점 */
  deductionsAvg: Deductions;
  levelConsistent: number; // |Δlevel| ≤ 1 인 질문 수
  levelChecked: number;
  inconsistentIds: string[];
  avgMs: number;
  /** 단계별 평균 시간(ms) */
  stageMsAvg: Record<string, number>;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** 단계 이름별 평균(그 단계가 있었던 실행만으로 계산). */
export function stageAverages(runs: EvalRun[]): Record<string, number> {
  const acc = new Map<string, number[]>();
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.timings ?? {})) acc.set(k, [...(acc.get(k) ?? []), v]);
  }
  return Object.fromEntries([...acc].map(([k, v]) => [k, Math.round(mean(v))]));
}

export function summarize(items: EvalItem[]): EvalSummary {
  const ok = items.filter((i) => !i.error && i.runs.length > 0);
  const runs = ok.flatMap((i) => i.runs);
  const inconsistent: string[] = [];
  let checked = 0;
  for (const i of ok) {
    if (i.runs.length < 2) continue;
    checked += 1;
    const levels = i.runs.map((r) => r.level);
    if (Math.max(...levels) - Math.min(...levels) > 1) inconsistent.push(i.id);
  }
  const deductionsAvg = Object.fromEntries(
    ISSUE_CATEGORIES.map((c) => [c, r2(mean(runs.map((r) => r.deductions[c])))]),
  ) as Deductions;
  return {
    questions: items.length,
    failed: items.filter((i) => Boolean(i.error) || i.runs.length === 0).map((i) => i.id),
    avgScore: r2(mean(runs.map((r) => r.score))),
    minScore: runs.length ? Math.min(...runs.map((r) => r.score)) : 0,
    deductionsAvg,
    levelConsistent: checked - inconsistent.length,
    levelChecked: checked,
    inconsistentIds: inconsistent,
    avgMs: Math.round(mean(runs.map((r) => r.totalMs))),
    stageMsAvg: stageAverages(runs),
  };
}

export function renderMarkdown(s: EvalSummary, items: EvalItem[], when: string): string {
  const rows = items.map((i) =>
    i.error
      ? `| ${i.id} | 실패(${i.error}) | | | |`
      : `| ${i.id} | ${i.runs.map((r) => r.level).join(" / ")} | ${i.runs.map((r) => r.score).join(" / ")} | ${
          i.runs.length > 1 ? Math.abs((i.runs[0]?.level ?? 0) - (i.runs[1]?.level ?? 0)) : "-"
        } | ${Math.round(mean(i.runs.map((r) => r.totalMs)) / 1000)}s |`,
  );
  return [
    `# 물어보기 골든 세트 평가 (${when})`,
    "",
    `- 질문 수: ${s.questions} (실패 ${s.failed.length})`,
    `- 평균 점수: ${s.avgScore} / 최저: ${s.minScore} (목표 평균 ≥ 9.5)`,
    `- 단계 일관성(같은 질문 2회, |Δ| ≤ 1): ${s.levelConsistent}/${s.levelChecked}`,
    `- 평균 소요: ${Math.round(s.avgMs / 1000)}s`,
    "",
    `- 단계별 평균 시간(ms): ${
      Object.entries(s.stageMsAvg)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(", ") || "-"
    }`,
    "",
    "## 지적 범주별 평균 감점",
    "",
    `| ${ISSUE_CATEGORIES.join(" | ")} |`,
    `|${ISSUE_CATEGORIES.map(() => "---").join("|")}|`,
    `| ${ISSUE_CATEGORIES.map((c) => String(s.deductionsAvg[c])).join(" | ")} |`,
    "",
    "## 질문별",
    "",
    "| id | 단계(1회/2회) | 점수 | Δ단계 | 평균 소요 |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    s.inconsistentIds.length ? `일관성 위반: ${s.inconsistentIds.join(", ")}` : "일관성 위반 없음",
    "",
  ].join("\n");
}

// ── 비교 모드 ──────────────────────────────────────────────

/** 오류 분류: ⓐ review(검토·재검토 단계) · ⓑ low_score(단계 무관) · ⓒ unreviewed · 그 밖은 작성 단계(비교에서 뺀다). */
export type EvalErrorClass = "review" | "low_score" | "unreviewed" | "authoring";

export function classifyEvalError(error: string): EvalErrorClass {
  const i = error.indexOf(":");
  const stage = i >= 0 ? error.slice(0, i) : "";
  const code = i >= 0 ? error.slice(i + 1) : error;
  if (code === "unreviewed") return "unreviewed";
  if (code === "low_score") return "low_score";
  if (stage === "review" || stage === "review2") return "review";
  return "authoring";
}

export interface ErrorCounts {
  review: number;
  lowScore: number;
  unreviewed: number;
  /** ⓐ+ⓑ+ⓒ — 게이트 1·C7 ② 의 비교 대상(오류가 난 문항 수). */
  gate: number;
  /** 작성 단계(expand·pack·generate·rewrite 의 도구 실패 등) — 따로 적고 비교에서 뺀다. */
  authoring: number;
}

export function countErrors(items: readonly EvalItem[]): ErrorCounts {
  const c: ErrorCounts = { review: 0, lowScore: 0, unreviewed: 0, gate: 0, authoring: 0 };
  for (const i of items) {
    if (!i.error) continue;
    const k = classifyEvalError(i.error);
    if (k === "review") c.review += 1;
    else if (k === "low_score") c.lowScore += 1;
    else if (k === "unreviewed") c.unreviewed += 1;
    else c.authoring += 1;
  }
  c.gate = c.review + c.lowScore + c.unreviewed;
  return c;
}

export interface CompareSide {
  file: string;
  reviewModel: string | null;
  claudeVersion: string | null;
  /** 결과 파일의 문항 수(오류 포함). */
  questions: number;
  /** --set 이 있을 때만: 결과의 문항 id 집합이 세트와 같은가(다르면 중간 중단 — S3 확인 0). */
  idSetMatchesSet: boolean | null;
  avgScore: number;
  levelConsistent: number;
  levelChecked: number;
  levelRatio: number | null;
  errors: ErrorCounts;
}

export interface Comparison {
  /** 두 실행 모두 오류 없이 끝난 문항 id. */
  intersection: string[];
  a: CompareSide;
  b: CompareSide;
}

export interface EvalResultFile {
  claudeVersion?: string;
  reviewModel?: string;
  items: EvalItem[];
}

const okIds = (items: readonly EvalItem[]): Set<string> =>
  new Set(items.filter((i) => !i.error && i.runs.length > 0).map((i) => i.id));

function side(
  name: string,
  f: EvalResultFile,
  both: Set<string>,
  setIds: Set<string> | null,
): CompareSide {
  const s = summarize(f.items.filter((i) => both.has(i.id)));
  const ids = new Set(f.items.map((i) => i.id));
  return {
    file: name,
    reviewModel: f.reviewModel ?? null,
    claudeVersion: f.claudeVersion ?? null,
    questions: f.items.length,
    idSetMatchesSet: setIds
      ? ids.size === setIds.size && [...setIds].every((id) => ids.has(id))
      : null,
    avgScore: s.avgScore,
    levelConsistent: s.levelConsistent,
    levelChecked: s.levelChecked,
    levelRatio: s.levelChecked > 0 ? r2(s.levelConsistent / s.levelChecked) : null,
    errors: countErrors(f.items),
  };
}

export function compareEvals(
  a: EvalResultFile,
  b: EvalResultFile,
  names: [string, string] = ["A", "B"],
  setIds: readonly string[] | null = null,
): Comparison {
  const okB = okIds(b.items);
  const both = new Set([...okIds(a.items)].filter((id) => okB.has(id)));
  const set = setIds ? new Set(setIds) : null;
  return {
    intersection: [...both],
    a: side(names[0], a, both, set),
    b: side(names[1], b, both, set),
  };
}

/** 파일이면 그대로, 폴더면 그 안의 <prefix>*.json 이 정확히 하나일 때 그 파일. */
export function resolveResultFile(path: string, prefix: string): string {
  if (!statSync(path).isDirectory()) return path;
  const found = readdirSync(path).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  if (found.length !== 1 || !found[0]) {
    throw new Error(
      `폴더에 ${prefix}*.json 이 ${String(found.length)}개예요 — 파일 경로를 직접 주세요`,
    );
  }
  return join(path, found[0]);
}

export function readEvalResult(path: string): EvalResultFile {
  const j = JSON.parse(readFileSync(path, "utf8")) as Partial<EvalResultFile> | null;
  if (!j || !Array.isArray(j.items))
    throw new Error(`eval 결과 형식이 아니에요: ${basename(path)}`);
  return j as EvalResultFile;
}

export function compareMain(args: string[]): number {
  const i = args.indexOf("--compare");
  const pa = i >= 0 ? args[i + 1] : undefined;
  const pb = i >= 0 ? args[i + 2] : undefined;
  if (!pa || !pb) {
    console.error("사용: eval-stats.ts --compare <결과 A> <결과 B> [--set <golden.jsonl>]");
    return 1;
  }
  const s = args.indexOf("--set");
  const setPath = s >= 0 ? args[s + 1] : undefined;
  const setIds = setPath
    ? readFileSync(setPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l) => (JSON.parse(l) as { id: string }).id)
    : null;
  const fa = resolveResultFile(pa, "eval-");
  const fb = resolveResultFile(pb, "eval-");
  const c = compareEvals(
    readEvalResult(fa),
    readEvalResult(fb),
    [basename(fa), basename(fb)],
    setIds,
  );
  console.log(JSON.stringify(c, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(compareMain(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : "비교 오류");
    process.exit(1);
  }
}
