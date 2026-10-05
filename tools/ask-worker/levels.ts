// 10단계 (docs/11-ask.md 정의와 동일). levelTitle 은 이 문구로 정규화한다.
export const LEVEL_TITLES: readonly string[] = [
  "아주 흔한 발달 과정",
  "흔하고 며칠이면 지남",
  "흔함·피곤·환경 변화 영향",
  "흔하지만 반복 → 작은 방법 1~2개",
  "방법 바꾸며 1주 기록",
  "2주 기록 후 재평가",
  "어린이집과 함께 관찰",
  "다음 소아과 진료 때 상담",
  "1~2주 안 전문가 상담 권함",
  "지금 바로 진료·연락(119·응급실·소아과)",
];

export function levelTitle(level: number): string {
  return LEVEL_TITLES[level - 1] ?? "";
}
