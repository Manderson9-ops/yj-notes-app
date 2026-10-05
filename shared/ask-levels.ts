// 물어보기(T-Q) 10단계·판정 어휘 금지 목록. 앱 화면·서버·워커가 같은 정의를 쓴다 (docs/11-ask.md §2).
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

/**
 * 답변에 쓰지 않는 판정·꼬리표 어휘(P1). 「이상」 은 「1주 이상」 처럼 수량에도 쓰이므로
 * 판정으로 쓰인 형태(이상하다·이상 행동·이상 소견 등)만 막는다.
 */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /정상/,
  /이상(?:하|해|한|함|이\s*있|\s*행동|\s*증상|\s*소견|\s*징후|\s*반응)/,
  /지연/,
  /장애/,
  /문제\s*아/,
  /자폐/,
  /adhd/i,
  /진단(?:명|받|됩|될|해야|이\s*나|을\s*내)/,
];

/** 금지어에 걸린 패턴 개수 대신 걸렸는지만 알린다(문장을 오류·로그에 옮기지 않는다). */
export function hasForbiddenWord(text: string): boolean {
  return FORBIDDEN_PATTERNS.some((p) => p.test(text));
}
