// 결정적 검사: 스키마, 금지어, redFlag→10단계·응급 처치 순서, 단계별 틀, 전문 기관 이름, ref·basis·날짜 실재,
// 작성자·장소 표기 대조, 「기록이 없어요」 오류 주장 대조(전수 검색 결과), 호칭·축 꼬리표·kind 규칙.
// 모델 호출 전에 코드로 먼저 걸러 검토 한 판을 아낀다.
import { hasForbiddenWord } from "../../shared/ask-forbidden.ts";
import { checkLevelTemplate, checkSpecialist, LEVEL_TEMPLATES } from "../../shared/ask-levels.ts";
import { GENERAL_BASIS } from "../../shared/ask-schema.ts";
import {
  answerSchema,
  ISSUE_CATEGORIES,
  type Answer,
  type IssueCategory,
  type ReviewIssue,
} from "./answer-schema.ts";
import { levelProblem, type LevelSuggestion } from "./level-suggest.ts";
import { levelTitle } from "./levels.ts";
import type { SearchSummary } from "./pack.ts";
import { refDomain, textMatchesDomain } from "./topics.ts";
import { FAMILY_REF_PREFIX, sameMethod, type FamilyInfo, type ReaskInfo } from "./family.ts";

export interface PackInfo {
  pack: string;
  refs: string[];
  /** 키워드 전수 검색 요약(없으면 관련 검사를 건너뛴다). */
  search?: SearchSummary;
  /** 질문 확장이 판단한 행동 질문 여부(확장 실패면 undefined → 검사 안 함). */
  isBehavior?: boolean | undefined;
  /** 질문 확장이 뽑은 주제 영역(없으면 근거-행동 주제 대조를 건너뛴다). */
  domains?: string[] | undefined;
  /** 질문에 적힌 빈도·지속·영향·공격성(확장 실패면 undefined → 단계 보정 검사 안 함). */
  severity?: Severity | undefined;
  /** 오늘 날짜(YYYY-MM-DD). 있으면 12개월보다 오래된 기록을 검사한다(없으면 건너뜀). */
  today?: string | undefined;
  /** 질문자 호칭(엄마·아빠·할머니…): summary 에서 3인칭으로 부르지 않는지 본다. */
  askedBy?: string | undefined;
  /** 질문에서 계산한 권장 단계(위급이면 없음). 모델 단계가 ±1 밖이면 근거를 대야 한다. */
  suggested?: LevelSuggestion | undefined;
  /** 가족 결과 구역에 실린 FAMILY-Q ref 와 잘 안 됐다고 한 방법(없으면 관련 검사를 건너뛴다). */
  family?: FamilyInfo | undefined;
  /** 다시 답변이면 이유 선택지와 이전 답의 해 볼 것. */
  reask?: ReaskInfo | undefined;
}

export interface Severity {
  frequency: string | null;
  duration: string | null;
  impact: string | null;
  aggression: string | null;
}

/** 결정적 검사 지적. HARD 는 막고(재작성 필요), SOFT 는 막지 않고 재작성 지시 + 감점으로 넘어간다. */
export type CheckSeverity = "hard" | "soft";
export type CheckCategory =
  IssueCategory | "schema" | "redflag" | "kind" | "forbidden" | "leak" | "emergency" | "level";

export interface CheckIssue {
  severity: CheckSeverity;
  /** HARD 는 schema·redflag·kind·forbidden·leak·emergency, SOFT 는 감점 범주(IssueCategory). */
  category: CheckCategory;
  text: string;
}

export interface CheckResult {
  /** 지적이 하나도 없음(HARD·SOFT 모두). */
  ok: boolean;
  /** 모든 지적의 문장(재작성 지시용). */
  issues: string[];
  items: CheckIssue[];
  hard: CheckIssue[];
  soft: CheckIssue[];
  answer: Answer | null;
}

/** SOFT 지적을 코드 쪽 감점용 검토 지적으로 바꾼다(범주별 고정 감점은 answer-schema 의 DEDUCTIONS). */
export function softToReviewIssues(soft: readonly CheckIssue[]): ReviewIssue[] {
  return soft.flatMap((i) =>
    ISSUE_CATEGORIES.includes(i.category as IssueCategory)
      ? [{ category: i.category as IssueCategory, where: "코드 검사", fix: i.text.slice(0, 200) }]
      : [],
  );
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
/** 가족에게 보이는 글에 쓰면 안 되는 내부 규칙·검색 표현과 검색 건수. */
const INTERNAL_PHRASE =
  /보수적인\s*쪽|더\s*일찍\s*확인을\s*권하는\s*쪽|월령\s*규준\s*경계|규준이\s*둘|연령대\s*경계|내부\s*규칙|전수\s*검색/;
const SEARCH_COUNT = /\d+\s*건/;
/** 질문과 관련 없는 기록을 「관련 없다」고 적어 두는 말. */
const UNRELATED =
  /직접\s*관련(?:은|이)?\s*없|관련\s*없|관련이\s*적|관련은\s*적|상관\s*없|지금과(?:는)?\s*(?:많이\s*)?달라/;
/** 가족에게 보이는 글에 쓰면 안 되는 내부 표지·파일·ID(refs 는 evidence.ref·tryNow.basis 에만). */
export const INTERNAL_LABEL =
  /권장\s*보다|권장\s*단계|[(（]\s*장소\s*모름\s*[)）]|장소\s*모름|[(（]\s*반\s*친구일\s*수\s*있음\s*[)）]|records\/|가이드\s*§|guide:|묶음|전수|INT-|NORM-|EMERG-|FAMILY-/;
/** 「이번엔 바꿔서」처럼 다시 권하는 이유(바뀐 점)를 밝히는 말. */
const CHANGE_WORDS =
  /이번엔|이번에는|바꿔|바꾼|바꿨|달리|다르게|대신|조금\s*다|방법을\s*바|변경|보완/;
/** 판단을 기다리라는 말 / 기다리지 말라는 말(한 답 안에서 함께 나오면 모순). */
const WAIT_WORDS = /다음\s*(?:진료|검진|방문)\s*때|며칠\s*(?:더\s*)?지켜|더\s*지켜보|두고\s*보/;
const NO_WAIT_WORDS = /기다리지\s*말|미루지\s*말|지금\s*바로|바로\s*(?:상담|연락|진료|예약)/;
/** 가족이 쓰고 있는 2주 저녁 식사 기록표를 가정하는 말(사실이 묶음에 있는데 조건·부재로 말함). */
const LOG_HEDGE =
  /(?:식사\s*기록(?:표)?|기록표)[^.。\n]{0,16}(?:있다면|있으시면|있으면|쓰고\s*계시면|쓰고\s*계신다면|쓰신다면|쓰시면|시작해|남겨\s*보세요)|(?:있다면|쓰고\s*계시면|쓰고\s*계신다면)[^.。\n]{0,16}(?:식사\s*기록|기록표)|식사\s*기록(?:은|이|표는)?[^.。\n]{0,12}없/;
export const DINNER_FACT = "저녁 식사 기록표를 쓰고 있어요";
const MONTH_MS = 30.4375 * 24 * 3600 * 1000;
/** summary·levelReason 의 질환·병 낱말(위급 질문 제외). 병원은 해당하지 않는다. */
const ILLNESS = /질환|(?:^|[^가-힣])병(?:이|을|에|은|는|도|일|인|으로|명|증|리|세|$|[^가-힣])/;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 119 안내에 처치를 미루는 말(구체 처치 동사가 없을 때만 문제). */
const DEFER_119 = /119[^.。\n]*안내(?:에|를)\s*따/;
const FIRST_AID_VERB = /두드리|밀어|압박|눕|지혈|눌러|치우|옆으로|돌려|꺼내|기침|뒤집/;

/** 가족 화면에 글로 보이는 칸(근거 ref·basis·날짜는 작은 출처 표시라 제외). */
export function familyStrings(a: Answer): string[] {
  return collectStrings({
    summary: a.summary,
    levelReason: a.levelReason,
    fromRecords: a.fromRecords.map((r) => [r.what, r.link]),
    tryNow: a.tryNow.map((t) => [t.action, t.say]),
    avoid: a.avoid,
    observe: a.observe,
    upIf: a.upIf,
    downIf: a.downIf,
    forAsker: a.forAsker,
    limits: (a as { limits?: unknown }).limits,
  });
}

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

// ── 「기록이 없어요」 주장 대조(전수 검색) ───────────────────

/** 「~ 기록이/근거가 없어요」 앞의 1~3 낱말(주장의 대상). */
const SUBJECT =
  /((?:\S+\s+){0,2}\S+?)\s*(?:에\s*대한\s*|에\s*관한\s*|관련\s*)?(?:기록이|기록에|근거가|묶음에|확인되지)/;
/** 낱말의 날짜 빈도가 이 비율 미만이면 변별력 있는 낱말로 본다. */
export const DISCRIMINATIVE_DAY_RATIO = 0.05;

/** 문장이 「~ 없어요」라고 주장하는 대상(없으면 문장 전체). */
export function claimSubject(sentence: string): string {
  const m = SUBJECT.exec(sentence)?.[1];
  if (m === undefined) return sentence;
  // 「~에 대한/관련」과 마지막 조사를 떼어 낱말만 남긴다
  const bare = m.replace(/\s*(?:에\s*대한|에\s*관한|관련)$/, "").trim();
  return bare.replace(/(?<=[가-힣]{2})(?:에|의|은|는|이|가|과|와)$/, "");
}

/**
 * 전수 검색이 그 주장을 반박하는가. 변별력 있는 낱말(날짜 빈도 5% 미만)이 주장 대상과 겹치거나,
 * 서로 다른 낱말 2개 이상이 한 글에 함께 걸렸고 둘 다 주장 대상과 겹칠 때만 센다. 흔한 낱말의 건수는 세지 않는다.
 */
export function claimRefuted(sentence: string, s: SearchSummary): string | null {
  const subject = claimSubject(sentence);
  const words = subject.split(/\s+/).filter((w) => w.length >= 2);
  const overlaps = (k: string): boolean => subject.includes(k) || words.some((w) => k.includes(w));
  const days = s.days ?? 0;
  if (days > 0 && s.keywordDays) {
    for (const [k, d] of Object.entries(s.keywordDays)) {
      if (d > 0 && d / days < DISCRIMINATIVE_DAY_RATIO && overlaps(k)) {
        const dates = (s.keywordDates?.[k] ?? []).slice(0, 4).join(", ");
        return `[ungrounded] 「${k}」 기록이 있어요${dates ? `: ${dates}` : ""} — 「없다」고 쓰지 말고 그 기록을 반영해요`;
      }
    }
  }
  for (const m of s.multi ?? []) {
    const hit = m.keywords.filter(overlaps);
    if (hit.length >= 2) {
      return `[ungrounded] 「${hit.slice(0, 3).join("·")}」 기록이 있어요: ${m.date} — 「없다」고 쓰지 말고 그 기록을 반영해요`;
    }
  }
  return null;
}

// ── 본 검사 ───────────────────────────────────────────────

/** evidence.ref·tryNow.basis 가 묶음에 실재하는가(HARD). FAMILY-Q ref 는 이번 묶음의 가족 결과에 있어야 한다. */
function checkRefs(
  answer: Answer,
  refs: ReadonlySet<string>,
  hard: (category: CheckCategory, text: string) => void,
): void {
  const famMissing = (r: string): boolean => r.startsWith(FAMILY_REF_PREFIX) && !refs.has(r);
  for (const e of answer.evidence) {
    const r = e.ref.trim();
    if (famMissing(r))
      hard("factual", `FAMILY-Q ref 가 이번 가족 결과에 없어요: ${r.slice(0, 40)}`);
    else if (!refs.has(r))
      hard("factual", `evidence.ref 가 근거 묶음에 없어요: ${e.ref.slice(0, 40)}`);
  }
  for (const t of answer.tryNow) {
    const b = t.basis.trim();
    if (famMissing(b))
      hard("factual", `FAMILY-Q ref 가 이번 가족 결과에 없어요: ${b.slice(0, 40)}`);
    else if (b !== GENERAL_BASIS && !refs.has(b)) {
      hard(
        "factual",
        `tryNow.basis 는 묶음의 ref 이거나 정확히 「${GENERAL_BASIS}」 여야 해요: ${b.slice(0, 40)}`,
      );
    }
  }
}

export function checkAnswer(raw: unknown, info: PackInfo, redFlag: boolean): CheckResult {
  const items: CheckIssue[] = [];
  const hard = (category: CheckCategory, text: string) =>
    items.push({ severity: "hard", category, text });
  const soft = (category: IssueCategory, text: string) =>
    items.push({ severity: "soft", category, text });
  const done = (answer: Answer | null): CheckResult => ({
    ok: items.length === 0 && answer !== null,
    issues: items.map((i) => i.text),
    items,
    hard: items.filter((i) => i.severity === "hard"),
    soft: items.filter((i) => i.severity === "soft"),
    answer,
  });

  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) {
      hard("schema", `스키마: ${i.path.join(".") || "(root)"} ${i.code}`);
    }
    return done(null);
  }
  // 축 꼬리표는 지우고, levelTitle 은 정규 문구로 고정하며, 해 볼 것이 틀의 최대 개수를 넘으면 앞쪽만 남긴다.
  const stripped = stripAxisTags(parsed.data);
  const maxTry = LEVEL_TEMPLATES[stripped.level]?.tryNow[1] ?? stripped.tryNow.length;
  const answer: Answer = {
    ...stripped,
    levelTitle: stripped.kind === "not_behavior" ? "" : levelTitle(stripped.level),
    tryNow: stripped.tryNow.slice(0, maxTry),
  };
  const strings = collectStrings(answer);
  const refs = new Set(info.refs);

  // ── HARD: 어느 질문에서나 막는다 ──
  if (redFlag && answer.level !== 10) hard("redflag", "redFlag 질문은 level 10 이어야 해요");
  if (redFlag && answer.kind !== "behavior")
    hard("kind", "위급 신호 질문은 kind 가 behavior 여야 해요");
  if (strings.some(hasForbiddenWord)) hard("forbidden", "금지어(판정·꼬리표 어휘)를 썼어요");
  if (strings.some((s) => INTERNAL_PHRASE.test(s) || SEARCH_COUNT.test(s))) {
    hard(
      "leak",
      "내부 규칙(보수적인 쪽 등)과 검색 건수(「N건」)는 가족에게 보이는 글에 쓰지 않아요: 지우고 내용만 말해요",
    );
  }
  const family = familyStrings(answer);
  if (family.some((s) => INTERNAL_LABEL.test(s))) {
    hard(
      "leak",
      "가족에게 보이는 글에 내부 표지·파일·ID(권장 단계·장소 모름·반 친구일 수 있음·records/·가이드 §·guide:·묶음·전수·INT-·NORM-)를 쓰지 않아요: 「어린이집 반 동생들」「선생님 알림장」「엄마 댓글」처럼 가족 말로 바꾸고, 근거 ID 는 evidence.ref·tryNow.basis 에만 써요",
    );
  }
  if (info.isBehavior === false && answer.kind === "behavior" && !redFlag) {
    hard("kind", "행동 질문이 아니에요: kind 를 not_behavior 로 하고 요약과 안내 한 줄만 써요");
  }
  if (
    answer.kind === "not_behavior" &&
    strings.some((s) => /\d{4}-\d{2}-\d{2}|검진|알림장/.test(s))
  ) {
    hard("leak", "행동 질문이 아니면 기록·검진·날짜를 언급하지 않아요");
  }

  // ── 위급 질문: 안전·응급 규칙만(주제·말씨·식사·단계 보정 규칙은 적용하지 않는다) ──
  if (redFlag) {
    if (answer.tryNow.some((t) => DEFER_119.test(t.action) && !FIRST_AID_VERB.test(t.action))) {
      hard(
        "emergency",
        "응급 처치를 「119 안내에 따라」로 미루지 말고 지금 할 처치를 먼저(119 신고는 동시에, 스피커폰) 적어요",
      );
    }
    if (
      [...refs].some((r) => r.startsWith("EMERG-")) &&
      !answer.tryNow.some((t) => t.basis.startsWith("EMERG-"))
    ) {
      soft("safety", "위급 처치의 basis 는 묶음의 EMERG-… ref 로 써요");
    }
    for (const m of checkSpecialist(answer.level, answer.upIf)) soft("safety", m);
    checkRefs(answer, refs, hard);
    return done(answer);
  }

  // ── SOFT: 막지 않는다(재작성 지시 + 코드 감점) ──
  if (strings.some((s) => HONORIFIC.test(s))) {
    soft(
      "style",
      "가족 호칭은 아버님·어머님 대신 적힌 역할 그대로(엄마·아빠·할머니·할아버지)로 써요",
    );
  }
  if ([answer.summary, answer.levelReason].some((s) => ILLNESS.test(s))) {
    soft("style", "summary·levelReason 에 질환·병 같은 말을 쓰지 않아요(진단처럼 읽혀요)");
  }
  const asker = (info.askedBy ?? "").trim();
  if (
    asker !== "" &&
    asker.length <= 12 &&
    new RegExp(`(?<![가-힣])${escapeRe(asker)}\\s*(?:는|은|가|이|께서)(?![가-힣])`).test(
      answer.summary,
    )
  ) {
    soft(
      "style",
      `summary 는 질문하신 분께 2인칭으로 써요(「${asker}가/는」처럼 3인칭으로 부르지 않아요: 「~하셨어요」)`,
    );
  }
  if (info.isBehavior === true && answer.kind === "not_behavior") {
    soft("template", "행동 질문으로 분류됐어요: kind 는 behavior 여야 해요");
  }
  if (answer.kind === "not_behavior") return done(answer);

  for (const m of checkLevelTemplate({ ...answer, observe: answer.observe ?? { howLong: "" } })) {
    soft(m.includes("연락할 곳") ? "safety" : "template", m);
  }
  for (const m of checkSpecialist(answer.level, answer.upIf)) soft("safety", m);

  checkRefs(answer, refs, hard);
  const dates = packDates(info.pack);
  const meta = packMeta(info.pack);
  for (const r of answer.fromRecords) {
    if (!dates.has(r.date)) {
      hard("factual", `fromRecords 날짜가 근거 묶음에 없어요: ${r.date}`);
      continue;
    }
    const m = meta.get(r.date);
    if (!m) continue;
    const a = statedAuthor(`${r.what} ${r.link}`);
    if (a && !m.authors.has(a)) {
      soft(
        "factual",
        `fromRecords ${r.date}: 작성자 표기(${a})가 묶음의 [작성자: ${[...m.authors].join("/")}] 와 달라요 — 표시 그대로 써요`,
      );
    }
    const p = statedPlace(`${r.what} ${r.link}`);
    if (p && !m.places.has(p) && !(m.places.size === 1 && m.places.has("모름"))) {
      soft(
        "factual",
        `fromRecords ${r.date}: 장소 표기(${p})가 묶음의 [장소: ${[...m.places].join("/")}] 와 달라요 — 표시 그대로 써요`,
      );
    }
  }
  if (answer.evidence.some((e) => e.point.trim() === ""))
    soft("style", "evidence.point 가 비어 있어요");
  if (answer.tryNow.some((t) => t.action.trim() === ""))
    soft("style", "tryNow.action 이 비어 있어요");

  for (const r of answer.fromRecords) {
    if (UNRELATED.test(r.link) || UNRELATED.test(r.what)) {
      soft(
        "record_link",
        `fromRecords ${r.date}: 질문과 관련 없는 기록은 빼요(link 에 「관련 없다」고 적지 말고 항목을 지워요)`,
      );
    }
  }

  // 단계 보정: 4단계 이상은 질문이 빈도·지속·영향·공격성을 적었거나 기록이 반복을 보여 줄 때만
  const sev = info.severity;
  if (sev && answer.level >= 4 && (info.suggested?.level ?? 0) < 4) {
    const stated = [sev.frequency, sev.duration, sev.impact, sev.aggression].some(
      (v) => v !== null && v.trim() !== "",
    );
    if (!stated) {
      const repeats = (info.search?.dates.length ?? 0) >= 2;
      if (answer.level >= 5 || !repeats) {
        soft(
          "template",
          "질문에 빈도·지속·영향·공격성이 적혀 있지 않으면 단계는 3 이하여야 해요(기록이 반복을 보이면 4단계까지, levelReason 에 그렇다고 적어요)",
        );
      } else if (!/기록|알림장|반복/.test(answer.levelReason)) {
        soft(
          "template",
          "4단계는 질문에 빈도·지속이 없으니 levelReason 에 기록이 반복을 보인다고 적어요",
        );
      }
    }
  }
  // 단계 권장값: 모델 단계는 권장과 같아야 한다(±1 은 특정 기록·근거를 댈 때만). 공격·퇴행 최소 단계 미만은 HARD.
  const sg = info.suggested;
  if (sg) {
    const p = levelProblem(answer.level, sg, answer.levelReason);
    if (p?.severity === "hard") hard("level", p.text);
    else if (p) soft("template", p.text);
    if (sg.noWait) {
      const waits = [
        answer.observe?.howLong ?? "",
        answer.observe?.how ?? "",
        ...answer.tryNow.map((t) => t.action),
        ...answer.downIf,
      ];
      if (waits.some((w) => /며칠\s*(?:더\s*)?지켜|지켜보기만/.test(w))) {
        soft(
          "template",
          "말 더듬이 4주 이상 이어졌으면 「며칠 지켜보기」가 아니라 언어재활사·소아과 상담을 안내해요",
        );
      }
    }
  }
  // 한 답 안의 모순: 기다리라는 말과 기다리지 말라는 말이 함께 있으면 안 된다
  {
    const body = [
      answer.summary,
      answer.levelReason,
      ...answer.tryNow.map((t) => t.action),
      ...answer.upIf,
      ...answer.downIf,
      answer.observe?.how ?? "",
    ].join(" ");
    if (WAIT_WORDS.test(body) && NO_WAIT_WORDS.test(body)) {
      soft(
        "template",
        `${String(answer.level)}단계 안내가 앞뒤로 어긋나요: 「다음 진료 때·지켜보기」와 「기다리지 말고·바로 상담」이 함께 있어요. 단계에 맞는 한쪽으로 통일해요(하던 것을 못 하게 되면 9단계)`,
      );
    }
  }
  // 12개월보다 오래된 기록은 link 에 지금 질문과 이어지는 이유(시간에 따른 변화)가 있어야 한다
  if (info.today) {
    const cutoff = Date.parse(info.today) - 12 * MONTH_MS;
    for (const r of answer.fromRecords) {
      if (
        Date.parse(r.date) < cutoff &&
        !/변화|달라졌|바뀌|늘었|줄었|계속|여전|이후|처음|예전부터|그때부터/.test(r.link)
      ) {
        soft(
          "record_link",
          `fromRecords ${r.date}: 12개월 넘은 기록이에요 — 최근 6개월 기록을 먼저 쓰고, 오래된 기록은 link 에 지금까지 어떻게 달라졌는지 적거나 빼요`,
        );
      }
    }
  }
  // 가족이 쓰는 저녁 식사 기록표가 사실로 있는데 조건(있다면)이나 부재(없어요)로 말함
  if (info.pack.includes(DINNER_FACT) && strings.some((x) => LOG_HEDGE.test(x))) {
    soft(
      "ungrounded",
      "가족은 지금 2주 저녁 식사 기록표를 쓰고 있어요(사실): 「있다면·쓰고 계시면」「기록이 없어요」로 말하지 말고 「지금 쓰고 계신 2주 저녁 식사 기록표」라고 분명히 써요",
    );
  }
  // 근거–행동 주제 대조: 그 ref 가 직접 뒷받침하는 행동에만 basis 로 쓴다
  if (info.domains !== undefined) {
    const wanted = new Set(info.domains);
    for (const t of answer.tryNow) {
      const d = refDomain(t.basis.trim());
      if (d === null || wanted.has(d)) continue;
      if (textMatchesDomain(`${t.action} ${t.say ?? ""}`, d)) continue;
      soft(
        "over_interpretation",
        `[over_interpretation] tryNow.basis ${t.basis.slice(0, 40)} 는 ${d} 주제 근거인데 이 행동·질문과 맞지 않아요 — 직접 뒷받침하는 행동에만 쓰고 아니면 「${GENERAL_BASIS}」`,
      );
    }
  }

  // 가족 결과: 잘 안 됐다고 한 방법을 바꾼 점 없이 그대로 다시 권하면 안 된다
  if (info.family && info.family.failed.length > 0) {
    const why = [answer.levelReason, answer.forAsker].join(" ");
    for (const t of answer.tryNow) {
      const hit = info.family.failed.find((f) => sameMethod(t.action, f.action));
      if (hit && !CHANGE_WORDS.test(`${t.action} ${t.say ?? ""} ${why}`)) {
        soft(
          "ungrounded",
          `tryNow 「${t.action.slice(0, 40)}」는 가족이 해 봤는데 잘 안 됐다고 한 방법과 같아요(질문 ${String(hit.id)}) — 그대로 다시 권하지 말고 바꾼 점을 분명히 써요(「이번엔 ○○를 바꿔서」) 또는 다른 방법으로 바꿔요`,
        );
      }
    }
  }
  // 다시 답변 「이미 해 봤어요」: 이전 해 볼 것과 같은 방법을 또 권하면 안 된다
  if (info.reask?.choice === "이미 해 봤어요" && info.reask.previousActions.length > 0) {
    for (const t of answer.tryNow) {
      if (info.reask.previousActions.some((p) => sameMethod(t.action, p))) {
        soft(
          "template",
          `다시 답변 이유가 「이미 해 봤어요」인데 tryNow 「${t.action.slice(0, 40)}」는 이전 답과 같은 방법이에요 — 다른 방법으로 바꿔요`,
        );
      }
    }
  }

  // 식사: 가이드 05 §3-1 의 기존 2주 저녁 기록을 쓰게 안내한다(새 기록을 시작하지 않는다)
  if (
    info.domains?.includes("feeding") === true &&
    [...refs].some((r) => /^guide:05.*#§3-1$/.test(r)) &&
    !strings.some((x) => /식사\s*기록/.test(x))
  ) {
    soft(
      "recall",
      "지금 쓰고 계신 2주 저녁 식사 기록표를 이어서 쓰도록 안내해요(새 기록을 시작하지 않아요)",
    );
  }

  // 전수 검색에 걸린 주제를 「기록이 없어요」라고 하는지(변별력 있는 낱말만 센다)
  const s = info.search;
  if (s) {
    const seen = new Set<string>();
    for (const text of strings) {
      for (const sentence of text.split(/[.!?。\n]/)) {
        if (!NOTHING.test(sentence)) continue;
        const refuted = claimRefuted(sentence, s);
        if (refuted) seen.add(refuted);
        if (NO_BASIS.test(sentence) && s.ints.length > 0) {
          seen.add(
            `[ungrounded] 근거 묶음에 실천 프로토콜이 있어요: ${s.ints.slice(0, 5).join(", ")}`,
          );
        }
      }
    }
    for (const m of seen) soft("ungrounded", m);
  }

  // 말 더듬 근거를 썼으면 DB 가 가리키는 전문가(언어재활사)를 이름으로
  const cited = [...answer.evidence.map((e) => e.ref), ...answer.tryNow.map((t) => t.basis)];
  if (
    answer.level >= 5 &&
    cited.some((r) => r.includes("FLUENCY")) &&
    info.pack.includes("언어재활사") &&
    !strings.some((x) => x.includes("언어재활사"))
  ) {
    soft("safety", "INT-FLUENCY 근거를 썼으니 upIf 에 언어재활사를 이름으로 적어요");
  }
  return done(answer);
}
