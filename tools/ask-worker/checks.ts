// 결정적 검사: 스키마, 금지어, redFlag→10단계, 단계별 틀, ref·basis·날짜가 근거 묶음에 실제 존재.
// 모델 호출 전에 코드로 먼저 걸러 검토 한 판을 아낀다.
import { hasForbiddenWord } from "../../shared/ask-forbidden.ts";
import { checkLevelTemplate, LEVEL_TEMPLATES } from "../../shared/ask-levels.ts";
import { GENERAL_BASIS } from "../../shared/ask-schema.ts";
import { answerSchema, type Answer } from "./answer-schema.ts";
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
  // levelTitle 은 정규 문구로 고정하고, 해 볼 것이 틀의 최대 개수를 넘으면 앞쪽(우선순위 높은 것)만 남긴다.
  const maxTry = LEVEL_TEMPLATES[parsed.data.level]?.tryNow[1] ?? parsed.data.tryNow.length;
  const answer: Answer = {
    ...parsed.data,
    levelTitle: levelTitle(parsed.data.level),
    tryNow: parsed.data.tryNow.slice(0, maxTry),
  };
  const issues: string[] = [];
  if (redFlag && answer.level !== 10) issues.push("redFlag 질문은 level 10 이어야 해요");
  if (collectStrings(answer).some(hasForbiddenWord)) {
    issues.push("금지어(판정·꼬리표 어휘)를 썼어요");
  }
  issues.push(...checkLevelTemplate(answer));
  const refs = new Set(info.refs);
  for (const e of answer.evidence) {
    if (!refs.has(e.ref.trim()))
      issues.push(`evidence.ref 가 근거 묶음에 없어요: ${e.ref.slice(0, 40)}`);
  }
  for (const t of answer.tryNow) {
    const b = t.basis.trim();
    if (b !== GENERAL_BASIS && !refs.has(b)) {
      issues.push(
        `tryNow.basis 는 묶음의 ref 이거나 정확히 「${GENERAL_BASIS}」 여야 해요: ${b.slice(0, 40)}`,
      );
    }
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
