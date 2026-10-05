// 물어보기(T-Q) 판정 어휘 금지 목록(P1). 서버·워커 검사용 — 앱 번들에는 넣지 않는다.
// 합성/일반 문구만 있다.

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
