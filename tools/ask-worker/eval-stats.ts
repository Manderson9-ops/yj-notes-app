// 골든 세트 평가 통계(순수 함수) — 질문 본문·답변 본문은 담지 않는다(id·숫자만).
export interface EvalRun {
  level: number;
  score: number;
  rubric: { evidence: number; records: number; actionable: number; safety: number; tone: number };
  totalMs: number;
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
  rubricAvg: EvalRun["rubric"];
  levelConsistent: number; // |Δlevel| ≤ 1 인 질문 수
  levelChecked: number;
  inconsistentIds: string[];
  avgMs: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (n: number): number => Math.round(n * 100) / 100;

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
  const key = (k: keyof EvalRun["rubric"]) => r2(mean(runs.map((r) => r.rubric[k])));
  return {
    questions: items.length,
    failed: items.filter((i) => Boolean(i.error) || i.runs.length === 0).map((i) => i.id),
    avgScore: r2(mean(runs.map((r) => r.score))),
    minScore: runs.length ? Math.min(...runs.map((r) => r.score)) : 0,
    rubricAvg: {
      evidence: key("evidence"),
      records: key("records"),
      actionable: key("actionable"),
      safety: key("safety"),
      tone: key("tone"),
    },
    levelConsistent: checked - inconsistent.length,
    levelChecked: checked,
    inconsistentIds: inconsistent,
    avgMs: Math.round(mean(runs.map((r) => r.totalMs))),
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
    "## 항목별 평균",
    "",
    "| 근거(3) | 기록(2) | 실행(2) | 안전(1.5) | 말투(1.5) |",
    "|---|---|---|---|---|",
    `| ${s.rubricAvg.evidence} | ${s.rubricAvg.records} | ${s.rubricAvg.actionable} | ${s.rubricAvg.safety} | ${s.rubricAvg.tone} |`,
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
