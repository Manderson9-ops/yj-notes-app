// 단계 권장값: 질문 글에서 결정적으로 계산한다(같은 질문이 1단계/3단계로 갈리는 것을 막는다). 모델 단계는 이 값과 같아야 한다.
// 기본: 빈도·지속·영향이 함께 적혔으면 4, 지속되는 모습(늘·자꾸·계속 등)이나 영향만 있으면 3, 한 번의 감정 표현·신호 없음은 2.
// 보정(위로만): (a) 남을 때리거나 무는 등 공격 행동 → 최소 4, (b) 4주 이상 이어짐 → 5(영향도 있으면 6),
// (c) 하던 것을 못 함·퇴행 → 최소 9(8 아님), (d) 말 더듬·막힘이 4주 이상 → 5~6 이고 「며칠 지켜보기」 금지.
// 위급은 대상이 아니다(10단계 고정).
export interface SeverityLike {
  frequency: string | null;
  duration: string | null;
  impact: string | null;
  aggression: string | null;
}

export interface LevelSuggestion {
  level: number;
  why: string;
  /** 이 단계 미만이면 HARD(공격·퇴행). */
  min?: number | undefined;
  /** 말 더듬 4주 이상: 「며칠 지켜보기」를 쓰지 않는다. */
  noWait?: boolean | undefined;
}

/** 지속되는 모습을 나타내는 말(빈도 신호). */
export const PERSISTENT =
  /(?<![가-힣])늘(?![가-힣])|항상|자꾸|계속|매일|맨날|맨\s*날|내내|가만히\s*못|하루에\s*\d+\s*번|밤마다|때마다/;
/** 한 번의 흔한 감정 표현(화난 말 등). */
export const EMOTIONAL = /미워|밉다|싫어|싫다|화나|화가|짜증|버럭|소리\s*질러|울어/;
/** 남에게 향하는 공격 행동 낱말과 그 대상. */
export const AGGRESSION_ACT =
  /때리|때려|때렸|때린|때림|물어|물었|무는|물기|물고|밀어|밀치|밀었|미는|밀기|할퀴|할퀸|던져|던지|던졌|던진/;
export const PERSON_TARGET =
  /친구|동생|언니|오빠|누나|형(?![가-힣])|엄마|아빠|선생|사람|아이들|애들|또래|상대|다른\s*아이|남을/;
/** 하던 것을 못 함·퇴행. */
export const SKILL_LOSS =
  /퇴행|(?:말하|걷|쓰|가리|부르|오르|뛰|세|입|신|씻)던\s*[^.。\n]{0,14}(?:이제|지금|요즘)\s*[^.。\n]{0,10}(?:못|안\s*해|안\s*하|거의\s*안)|하던\s*(?:것|걸|말|행동|일)[^.。\n]{0,14}(?:못|안\s*해|안\s*하|거의\s*안)|못\s*하게\s*(?:됐|되었|돼)|(?:예전|전)에?는?\s*[^.。\n]{0,20}(?:했는데|하던)\s*[^.。\n]{0,14}(?:이제|지금|요즘)\s*[^.。\n]{0,10}(?:못|안\s*해|안\s*하|거의\s*안)|할\s*줄\s*알던/;
/** 말 더듬·막힘. */
export const FLUENCY =
  /더듬|말이\s*막|말\s*막|말문이\s*막|반복해서\s*말|같은\s*말을\s*반복|첫\s*음절/;

const has = (v: string | null | undefined): boolean =>
  v !== null && v !== undefined && v.trim() !== "";

/** 글에 4주 이상 이어졌다는 표현이 있는가(한 달·몇 주째·N주째 N≥4·몇 달·N달째). */
export function durationAtLeast4Weeks(text: string): boolean {
  if (/한\s*달|몇\s*달|몇\s*주째|몇\s*주\s*(?:동안|넘|간)/.test(text)) return true;
  for (const m of text.matchAll(/(\d+)\s*(?:개월|달)\s*(?:째|동안|넘|이상)/g)) {
    if (Number(m[1]) >= 1) return true;
  }
  for (const m of text.matchAll(/(\d+)\s*주(?!일|말)\s*(?:째|동안|넘|이상|간|정도|가량)?/g)) {
    if (Number(m[1]) >= 4) return true;
  }
  return false;
}

export function suggestLevel(
  body: string,
  sev?: SeverityLike,
  domains: readonly string[] = [],
): LevelSuggestion {
  const freq = PERSISTENT.test(body) || has(sev?.frequency);
  const impactText = has(sev?.impact);
  const impact = impactText || has(sev?.aggression) || has(sev?.duration);
  let out: LevelSuggestion;
  if (freq && impact) out = { level: 4, why: "빈도와 영향·지속이 함께 적혀 있어요" };
  else if (impact) out = { level: 3, why: "영향·지속은 적혀 있지만 빈도는 없어요" };
  else if (freq) out = { level: 3, why: "지속되는 모습을 걱정하지만 영향은 적혀 있지 않아요" };
  else if (EMOTIONAL.test(body)) out = { level: 2, why: "한 번의 흔한 감정 표현이에요" };
  else out = { level: 2, why: "빈도·지속·영향이 적혀 있지 않아요" };

  const all = `${body} ${sev?.aggression ?? ""} ${sev?.duration ?? ""}`;
  const raise = (level: number, why: string, min?: number): void => {
    if (level > out.level) out = { ...out, level, why };
    if (min !== undefined) out = { ...out, min: Math.max(out.min ?? 0, min) };
  };
  const fluent = domains.includes("fluency") || FLUENCY.test(body);
  const long = durationAtLeast4Weeks(`${body} ${sev?.duration ?? ""}`);
  if (AGGRESSION_ACT.test(all) && PERSON_TARGET.test(all)) {
    raise(4, "남을 때리거나 무는 등 공격 행동이에요(선생님과 함께 살펴보는 단계)", 4);
  }
  if (long) {
    raise(impactText ? 6 : 5, "4주 이상 이어진 모습이에요");
    if (fluent) out = { ...out, noWait: true, why: "말 더듬·막힘이 4주 이상 이어졌어요" };
  }
  // 최소 9 는 질문 글에 「하던 것을 이제 못/안 한다」가 분명히 있을 때만(확장 모델의 domain 추정만으로는 올리지 않는다:
  // 동생이 생겨 아기처럼 구는 모습 같은 흔한 일시적 퇴행을 9 로 올리는 오류가 있었다).
  if (SKILL_LOSS.test(body)) {
    raise(9, "하던 것을 못 하게 된 퇴행이에요(기다리지 않고 바로 상담)", 9);
  }
  return out;
}

/** 모델 단계 검사. 최소 단계 미만이면 HARD, 권장과 다르면 SOFT(±1 이고 특정 기록·근거를 대면 통과). */
export function levelProblem(
  level: number,
  s: LevelSuggestion,
  levelReason: string,
): { severity: "hard" | "soft"; text: string } | null {
  if (s.min !== undefined && level < s.min) {
    return {
      severity: "hard",
      text: `이 질문은 ${String(s.min)}단계 이상이에요(${s.why}): 단계를 ${String(s.min)} 이상으로 올려요`,
    };
  }
  if (level === s.level) return null;
  const cites = /\d{4}-\d{2}-\d{2}|알림장|검진|기록에서|기록을|근거/.test(levelReason);
  if (Math.abs(level - s.level) <= 1 && cites) return null;
  return {
    severity: "soft",
    text: `질문 내용으로 계산한 권장 단계는 ${String(s.level)}(${s.why})예요. 이 단계로 하거나, ±1 로 바꾸려면 levelReason 에 그렇게 보는 특정 기록(날짜·알림장)이나 근거를 적어요`,
  };
}

/** 권장 단계와 같거나, ±1 이면서 특정 기록·근거를 댄 경우(최소 단계 미만은 불통과). */
export function levelNearSuggestion(
  level: number,
  s: LevelSuggestion,
  levelReason: string,
): boolean {
  return levelProblem(level, s, levelReason) === null;
}
