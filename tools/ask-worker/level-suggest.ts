// 낮은 단계의 안정화: 질문 글에서 결정적으로 권장 단계를 계산한다(같은 질문이 1단계/3단계로 갈리는 것을 막는다).
// 규칙: 빈도·지속·영향이 함께 적혔으면 4, 지속되는 모습(늘·자꾸·계속·가만히 못 등)을 걱정하지만 영향이 없으면 3,
// 한 번의 흔한 감정 표현이거나 아무 신호도 없으면 2. 위급은 대상이 아니다(10단계 고정).
export interface SeverityLike {
  frequency: string | null;
  duration: string | null;
  impact: string | null;
  aggression: string | null;
}

export interface LevelSuggestion {
  level: number;
  why: string;
}

/** 지속되는 모습을 나타내는 말(빈도 신호). */
export const PERSISTENT =
  /(?<![가-힣])늘(?![가-힣])|항상|자꾸|계속|매일|맨날|맨\s*날|내내|가만히\s*못|하루에\s*\d+\s*번|밤마다|때마다/;
/** 한 번의 흔한 감정 표현(화난 말 등). */
export const EMOTIONAL = /미워|밉다|싫어|싫다|화나|화가|짜증|버럭|소리\s*질러|울어/;

const has = (v: string | null | undefined): boolean =>
  v !== null && v !== undefined && v.trim() !== "";

export function suggestLevel(body: string, sev?: SeverityLike): LevelSuggestion {
  const freq = PERSISTENT.test(body) || has(sev?.frequency);
  const impact = has(sev?.impact) || has(sev?.aggression) || has(sev?.duration);
  if (freq && impact) return { level: 4, why: "빈도와 영향·지속이 함께 적혀 있어요" };
  if (impact) return { level: 3, why: "영향·지속은 적혀 있지만 빈도는 없어요" };
  if (freq) return { level: 3, why: "지속되는 모습을 걱정하지만 영향은 적혀 있지 않아요" };
  if (EMOTIONAL.test(body)) return { level: 2, why: "한 번의 흔한 감정 표현이에요" };
  return { level: 2, why: "빈도·지속·영향이 적혀 있지 않아요" };
}

/** 모델 단계가 권장 단계 ±1 안이거나 levelReason 이 기록·근거를 대면 통과. */
export function levelNearSuggestion(
  level: number,
  s: LevelSuggestion,
  levelReason: string,
  refs: readonly string[],
): boolean {
  if (Math.abs(level - s.level) <= 1) return true;
  if (/기록|알림장|검진|근거|\d{4}-\d{2}-\d{2}/.test(levelReason)) return true;
  return refs.some((r) => r.length > 3 && levelReason.includes(r));
}
