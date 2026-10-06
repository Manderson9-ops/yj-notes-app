// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import { Notice } from "../Notice";

/**
 * 위급 신호 경고 카드: 진지한 영역(data-tone="serious": 장식·모션 끔) + 경고 상자(색 + 아이콘 + 글).
 * 글은 문장 단위로 나눈다(번들 한글 장문 검사 G7). 답이 오기 전에도 먼저 보여 준다.
 */
export function RedFlagCard() {
  return (
    <div data-tone="serious" className="ask-redflag">
      <Notice tone="alert">
        <strong>지금 바로 119 또는 응급실·소아과에 연락하세요.</strong>
        <br />
        <span>아래 답변은 연락한 뒤에 읽어 주세요.</span>
      </Notice>
    </div>
  );
}
