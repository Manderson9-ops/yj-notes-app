// 결정적 검사: 스키마, 금지어, redFlag→10단계, ref·날짜가 근거 묶음에 실제 존재.
// 모델 호출 전후에 코드로 먼저 걸러, 모델 검토가 놓치는 것을 막는다.
import { answerSchema, type Answer } from "./answer-schema.ts";
import { hasForbiddenWord } from "../../shared/ask-forbidden.ts";
import { levelTitle } from "./levels.ts";

export interface PackInfo {
  pack: string;
  refs: string[];
}

export interface CheckResult {
  ok: boolean;
  issues: string[];
  answer: Answer | null;
}

export function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out);
  return out;
}

export function packDates(pack: string): Set<string> {
  return new Set(pack.match(/\d{4}-\d{2}-\d{2}/g) ?? []);
}

export function checkAnswer(raw: unknown, info: PackInfo, redFlag: boolean): CheckResult {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `스키마: ${i.path.join(".") || "(root)"} ${i.code}`);
    return { ok: false, issues, answer: null };
  }
  // levelTitle 은 정규 문구로 고정한다(모델이 말을 바꿔 쓰는 것을 막는다).
  const answer: Answer = { ...parsed.data, levelTitle: levelTitle(parsed.data.level) };
  const issues: string[] = [];
  if (redFlag && answer.level !== 10) issues.push("redFlag 질문은 level 10 이어야 해요");
  if (collectStrings(answer).some(hasForbiddenWord))
    issues.push("금지어(판정·꼬리표 어휘)를 썼어요");
  const refs = new Set(info.refs);
  for (const e of answer.evidence) {
    if (!refs.has(e.ref.trim()))
      issues.push(`evidence.ref 가 근거 묶음에 없어요: ${e.ref.slice(0, 40)}`);
  }
  const dates = packDates(info.pack);
  for (const r of answer.fromRecords) {
    if (!dates.has(r.date)) issues.push(`fromRecords 날짜가 근거 묶음에 없어요: ${r.date}`);
  }
  if (answer.evidence.some((e) => e.point.trim() === ""))
    issues.push("evidence.point 가 비어 있어요");
  if (answer.tryNow.some((t) => t.action.trim() === ""))
    issues.push("tryNow.action 이 비어 있어요");
  return { ok: issues.length === 0, issues, answer };
}
