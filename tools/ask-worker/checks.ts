// 결정적 검사: 스키마, 금지어, redFlag→10단계, ref·날짜가 근거 묶음에 실제 존재.
// 모델 호출 전후에 코드로 먼저 걸러, 모델 검토가 놓치는 것을 막는다.
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

// 숫자+(단위) 바로 뒤의 "이상"(예: 2주 이상, 38도 이상)은 기간·횟수 표현이라 허용한다.
const NUM_BEFORE =
  /(?:\d|이틀|사흘|나흘|닷새|열흘|하루|일주일|보름|한 ?달|[한두세네]|다섯|여섯|일곱|여덟|아홉|열)\s*(?:주|일|개월|달|회|번|분|시간|도|세|살|개|명|끼|차례|군데|곳|%|kg|cm)?\s*$/;
const FORBIDDEN_PLAIN = ["정상", "비정상", "지연", "문제아", "자폐", "ADHD", "과잉행동", "품행"];

export function findForbidden(s: string): string[] {
  const found = new Set<string>();
  for (const w of FORBIDDEN_PLAIN) if (s.includes(w)) found.add(w);
  for (const m of s.matchAll(/이상/g)) {
    if (!NUM_BEFORE.test(s.slice(0, m.index))) found.add("이상");
  }
  for (const m of s.matchAll(/장애/g)) {
    if (!s.startsWith("물", m.index + 2)) found.add("장애");
  }
  for (const m of s.matchAll(/진단/g)) {
    // 「진단하지 않아요」「진단이 아니에요」처럼 부정하는 말은 허용한다.
    if (!/^진단(?:하지 않|이 아니|은 아니|할 수 없|을 대신)/.test(s.slice(m.index)))
      found.add("진단");
  }
  return [...found];
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
  const words = new Set<string>();
  for (const s of collectStrings(answer)) for (const w of findForbidden(s)) words.add(w);
  if (words.size > 0) issues.push(`금지어 사용: ${[...words].join(", ")}`);
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
