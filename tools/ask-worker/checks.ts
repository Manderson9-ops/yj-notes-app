// 결정적 검사: 스키마, 금지어, redFlag→10단계·응급 처치 순서, 단계별 틀, 전문 기관 이름, ref·basis·날짜 실재,
// 작성자·장소 표기 대조, 「기록이 없어요」 오류 주장 대조(전수 검색 결과), 호칭·축 꼬리표·kind 규칙.
// 모델 호출 전에 코드로 먼저 걸러 검토 한 판을 아낀다.
import { hasForbiddenWord } from "../../shared/ask-forbidden.ts";
import { checkLevelTemplate, checkSpecialist, LEVEL_TEMPLATES } from "../../shared/ask-levels.ts";
import { GENERAL_BASIS } from "../../shared/ask-schema.ts";
import { answerSchema, type Answer } from "./answer-schema.ts";
import { levelTitle } from "./levels.ts";
import type { SearchSummary } from "./pack.ts";

export interface PackInfo {
  pack: string;
  refs: string[];
  /** 키워드 전수 검색 요약(없으면 관련 검사를 건너뛴다). */
  search?: SearchSummary;
  /** 질문 확장이 판단한 행동 질문 여부(확장 실패면 undefined → 검사 안 함). */
  isBehavior?: boolean | undefined;
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

// ── 문구 규칙 ─────────────────────────────────────────────

/** 판단 축 이름을 꼬리표처럼 단 것: 「(장소)」「(강도)」… 화면에 새면 안 되므로 자동으로 지운다. */
const AXIS_TAG = /\s*[(（]\s*(?:장소|강도|빈도|지속|생활\s*지장|월령)\s*[)）]/g;
/** 가족 호칭은 적힌 역할 그대로(엄마·아빠·할머니·할아버지). */
const HONORIFIC = /아버님|어머님|할머님|할아버님/;
/** 「기록이 없어요」류 주장. */
const NOTHING = /기록이\s*없|기록에\s*없|근거가\s*없|묶음에\s*없|확인되지\s*않/;
const NO_BASIS = /근거가\s*(?:없|부족)/;
/** 119 안내에 처치를 미루는 말(구체 처치 동사가 없을 때만 문제). */
const DEFER_119 = /119[^.。\n]*안내(?:에|를)\s*따/;
const FIRST_AID_VERB = /두드리|밀어|압박|눕|지혈|눌러|치우|옆으로|돌려|꺼내|기침|뒤집/;

export function stripAxisTags<T>(v: T): T {
  if (typeof v === "string")
    return v
      .replace(AXIS_TAG, "")
      .replace(/\s{2,}/g, " ")
      .trim() as T;
  if (Array.isArray(v)) return v.map((x: unknown) => stripAxisTags(x)) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripAxisTags(x)])) as T;
  }
  return v;
}

// ── 작성자·장소 대조 ──────────────────────────────────────

interface Meta {
  authors: Set<string>;
  places: Set<string>;
}

/** 묶음의 [날짜][작성자: …][장소: …] 표시를 날짜별로 모은다. */
export function packMeta(pack: string): Map<string, Meta> {
  const out = new Map<string, Meta>();
  for (const m of pack.matchAll(/\[(\d{4}-\d{2}-\d{2})\]\[작성자: ([^\]]+)\]\[장소: ([^\]]+)\]/g)) {
    const [, d, a, p] = m;
    if (!d || !a || !p) continue;
    const e = out.get(d) ?? { authors: new Set<string>(), places: new Set<string>() };
    e.authors.add(a);
    e.places.add(p);
    out.set(d, e);
  }
  return out;
}

export function statedAuthor(s: string): "교사" | "부모" | null {
  const teacher = /교사|선생님|원장/.test(s);
  const parent = /부모|엄마|아빠|가족|어머니|아버지|할머니|할아버지/.test(s);
  if (teacher === parent) return null; // 둘 다/둘 다 아님이면 판단하지 않는다
  return teacher ? "교사" : "부모";
}

export function statedPlace(s: string): "어린이집" | "집" | null {
  const daycare = /어린이집|원에서/.test(s);
  const home = /집에서|집에|우리\s*집/.test(s.replace(/어린이집/g, ""));
  if (daycare === home) return null;
  return daycare ? "어린이집" : "집";
}

// ── 본 검사 ───────────────────────────────────────────────

export function checkAnswer(raw: unknown, info: PackInfo, redFlag: boolean): CheckResult {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `스키마: ${i.path.join(".") || "(root)"} ${i.code}`);
    return { ok: false, issues, answer: null };
  }
  // 축 꼬리표는 지우고, levelTitle 은 정규 문구로 고정하며, 해 볼 것이 틀의 최대 개수를 넘으면 앞쪽만 남긴다.
  const stripped = stripAxisTags(parsed.data);
  const maxTry = LEVEL_TEMPLATES[stripped.level]?.tryNow[1] ?? stripped.tryNow.length;
  const answer: Answer = {
    ...stripped,
    levelTitle: levelTitle(stripped.level),
    tryNow: stripped.tryNow.slice(0, maxTry),
  };
  const issues: string[] = [];
  const strings = collectStrings(answer);

  if (redFlag && answer.level !== 10) issues.push("redFlag 질문은 level 10 이어야 해요");
  if (redFlag && answer.kind !== "behavior")
    issues.push("위급 신호 질문은 kind 가 behavior 여야 해요");
  if (strings.some(hasForbiddenWord)) issues.push("금지어(판정·꼬리표 어휘)를 썼어요");
  if (strings.some((s) => HONORIFIC.test(s))) {
    issues.push(
      "가족 호칭은 아버님·어머님 대신 적힌 역할 그대로(엄마·아빠·할머니·할아버지)로 써요",
    );
  }
  if (info.isBehavior === false && answer.kind === "behavior" && !redFlag) {
    issues.push("행동 질문이 아니에요: kind 를 not_behavior 로 하고 요약과 안내 한 줄만 써요");
  }
  if (info.isBehavior === true && answer.kind === "not_behavior" && !redFlag) {
    issues.push("행동 질문으로 분류됐어요: kind 는 behavior 여야 해요");
  }

  if (answer.kind === "not_behavior") {
    // 기록·검진을 드러내지 않는다
    if (strings.some((s) => /\d{4}-\d{2}-\d{2}|검진|알림장/.test(s))) {
      issues.push("행동 질문이 아니면 기록·검진·날짜를 언급하지 않아요");
    }
    return { ok: issues.length === 0, issues, answer };
  }

  issues.push(...checkLevelTemplate({ ...answer, observe: answer.observe ?? { howLong: "" } }));
  issues.push(...checkSpecialist(answer.level, answer.upIf));

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
  const meta = packMeta(info.pack);
  for (const r of answer.fromRecords) {
    if (!dates.has(r.date)) {
      issues.push(`fromRecords 날짜가 근거 묶음에 없어요: ${r.date}`);
      continue;
    }
    const m = meta.get(r.date);
    if (!m) continue;
    const a = statedAuthor(`${r.what} ${r.link}`);
    if (a && !m.authors.has(a)) {
      issues.push(
        `fromRecords ${r.date}: 작성자 표기(${a})가 묶음의 [작성자: ${[...m.authors].join("/")}] 와 달라요 — 표시 그대로 써요`,
      );
    }
    const p = statedPlace(`${r.what} ${r.link}`);
    if (p && !m.places.has(p) && !(m.places.size === 1 && m.places.has("모름"))) {
      issues.push(
        `fromRecords ${r.date}: 장소 표기(${p})가 묶음의 [장소: ${[...m.places].join("/")}] 와 달라요 — 표시 그대로 써요`,
      );
    }
  }
  if (answer.evidence.some((e) => e.point.trim() === ""))
    issues.push("evidence.point 가 비어 있어요");
  if (answer.tryNow.some((t) => t.action.trim() === ""))
    issues.push("tryNow.action 이 비어 있어요");

  // 전수 검색에 걸린 주제를 「기록이 없어요」라고 하는지
  const s = info.search;
  if (s) {
    const seen = new Set<string>();
    for (const text of strings) {
      for (const sentence of text.split(/[.!?。\n]/)) {
        if (!NOTHING.test(sentence)) continue;
        const hitKeyword = Object.entries(s.keywords).some(
          ([k, n]) => n > 0 && sentence.includes(k),
        );
        if (s.total > 0 && hitKeyword) {
          seen.add(
            `[ungrounded] 전수 검색에 ${String(s.total)}건이 있어요: ${s.dates.slice(0, 6).join(", ")}`,
          );
        }
        if (NO_BASIS.test(sentence) && s.ints.length > 0) {
          seen.add(
            `[ungrounded] 근거 묶음에 실천 프로토콜이 있어요: ${s.ints.slice(0, 5).join(", ")}`,
          );
        }
      }
    }
    issues.push(...seen);
  }

  // 응급 처치: 「119 안내에 따라」로 미루지 않는다, 묶음의 응급 근거를 basis 로 쓴다
  if (redFlag) {
    if (answer.tryNow.some((t) => DEFER_119.test(t.action) && !FIRST_AID_VERB.test(t.action))) {
      issues.push(
        "응급 처치를 「119 안내에 따라」로 미루지 말고 지금 할 처치를 먼저(119 신고는 동시에, 스피커폰) 적어요",
      );
    }
    if (refs.has("EMERG-KDCA-2025") && !answer.tryNow.some((t) => t.basis.startsWith("EMERG-"))) {
      issues.push("위급 처치의 basis 는 묶음의 EMERG-… ref 로 써요");
    }
  }

  // 말 더듬 근거를 썼으면 DB 가 가리키는 전문가(언어재활사)를 이름으로
  const cited = [...answer.evidence.map((e) => e.ref), ...answer.tryNow.map((t) => t.basis)];
  if (
    answer.level >= 5 &&
    cited.some((r) => r.includes("FLUENCY")) &&
    info.pack.includes("언어재활사") &&
    !strings.some((x) => x.includes("언어재활사"))
  ) {
    issues.push("INT-FLUENCY 근거를 썼으니 upIf 에 언어재활사를 이름으로 적어요");
  }
  return { ok: issues.length === 0, issues, answer };
}
