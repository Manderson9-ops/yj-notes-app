// 물어보기(T-Q) 10단계 정의. 앱 화면·서버·워커가 같은 정의를 쓴다 (docs/11-ask.md §2).
// 합성/일반 문구만 있다. 아이 자료 없음.

export const ASK_LEVELS = [
  { level: 1, title: "아주 흔한 발달 과정", band: "ok" },
  { level: 2, title: "흔하고 며칠이면 지남", band: "ok" },
  { level: 3, title: "흔함, 피곤·환경 변화 영향", band: "ok" },
  { level: 4, title: "흔하지만 반복, 작은 방법 1~2개", band: "info" },
  { level: 5, title: "방법 바꾸며 1주 기록", band: "info" },
  { level: 6, title: "2주 기록 후 재평가", band: "info" },
  { level: 7, title: "어린이집과 함께 관찰", band: "warn" },
  { level: 8, title: "다음 소아과 진료 때 상담", band: "warn" },
  { level: 9, title: "1~2주 안 전문가 상담 권함", band: "warn" },
  { level: 10, title: "지금 바로 진료·연락", band: "alert" },
] as const;

export type AskBand = "ok" | "info" | "warn" | "alert";

export function levelInfo(level: number): { level: number; title: string; band: AskBand } {
  const found = ASK_LEVELS.find((l) => l.level === level);
  return found ?? { level, title: "", band: "info" };
}

// ───────────────────────── 단계별 답변 틀 (프롬프트 + 결정적 검사 공용) ─────────────────────────
// 단계가 높을수록 "해 볼 것" 은 늘리지 않고, 관찰 기간·연락처가 구체적이어야 한다(강도 일치).

export interface LevelTemplate {
  /** tryNow 개수 [최소, 최대] */
  tryNow: readonly [number, number];
  /** observe.howLong 이 가져야 할 표현(프롬프트에 그대로 안내) */
  howLongLabel: string;
  /** observe.howLong 이 이 중 하나와 맞아야 한다 */
  howLongPattern: RegExp;
  /** 올라가는 신호(upIf) 중 연락할 곳이 하나는 있어야 하는가 */
  needContact: boolean;
}

const TPL = (
  tryNow: readonly [number, number],
  howLongLabel: string,
  howLongPattern: RegExp,
  needContact: boolean,
): LevelTemplate => ({ tryNow, howLongLabel, howLongPattern, needContact });

const SOON = /며칠|지켜|필요\s*없/;
const WEEK1 = /1\s*주|일\s*주일/;
const WEEK2 = /2\s*주|이\s*주/;
const D34 = /3\s*[~∼\-–]\s*4\s*일/;
const BEFORE_VISIT = /진료|상담/;
const NOW = /지금|즉시|바로/;

export const LEVEL_TEMPLATES: Record<number, LevelTemplate> = {
  1: TPL([1, 2], "며칠 지켜보기", SOON, false),
  2: TPL([1, 2], "며칠 지켜보기", SOON, false),
  3: TPL([2, 2], "며칠 지켜보기", SOON, false),
  4: TPL([2, 2], "3~4일", D34, true),
  5: TPL([2, 3], "1주", WEEK1, true),
  6: TPL([2, 3], "2주", WEEK2, true),
  7: TPL([2, 3], "2주", WEEK2, true),
  8: TPL([2, 3], "진료·상담 전까지", BEFORE_VISIT, true),
  9: TPL([2, 3], "진료·상담 전까지", BEFORE_VISIT, true),
  10: TPL([1, 3], "지금", NOW, true),
};

/** 올라가는 신호에 이 중 하나는 있어야 한다(누구에게 연락하는지). */
export const CONTACT_PATTERN = /소아과|어린이집\s*선생|선생님|발달\s*상담|전문가|병원|119|응급/;

export interface TemplateInput {
  level: number;
  tryNow: readonly unknown[];
  observe: { howLong: string };
  upIf: readonly string[];
}

export function levelTemplateText(level: number): string {
  const t = LEVEL_TEMPLATES[level];
  if (!t) return "";
  const n =
    t.tryNow[0] === t.tryNow[1]
      ? `${String(t.tryNow[0])}개`
      : `${String(t.tryNow[0])}~${String(t.tryNow[1])}개`;
  return `해 볼 것 ${n}, 관찰 기간 「${t.howLongLabel}」${t.needContact ? ", 올라가는 신호에 연락할 곳(소아과·어린이집 선생님·발달 상담·119)" : ""}`;
}

/** 단계 틀 위반을 정확한 문장으로 돌려준다(없으면 빈 배열). */
export function checkLevelTemplate(a: TemplateInput): string[] {
  const t = LEVEL_TEMPLATES[a.level];
  if (!t) return [];
  const issues: string[] = [];
  const n = a.tryNow.length;
  if (n < t.tryNow[0] || n > t.tryNow[1]) {
    issues.push(
      `단계 ${String(a.level)} 은 tryNow 가 ${String(t.tryNow[0])}~${String(t.tryNow[1])}개여야 해요(지금 ${String(n)}개)`,
    );
  }
  if (!t.howLongPattern.test(a.observe.howLong)) {
    issues.push(`단계 ${String(a.level)} 의 observe.howLong 은 「${t.howLongLabel}」 이어야 해요`);
  }
  if (t.needContact && !a.upIf.some((s) => CONTACT_PATTERN.test(s))) {
    issues.push("upIf 중 하나에 연락할 곳(소아과·어린이집 선생님·발달 상담·119)을 적어야 해요");
  }
  return issues;
}
