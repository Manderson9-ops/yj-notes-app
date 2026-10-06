// 골든 세트 평가 통계(순수 함수) — 질문 본문·답변 본문은 담지 않는다(id·숫자·범주만).
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
}

export interface EvalItem {
  id: string;
  runs: EvalRun[]; // 같은 질문 2회
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
