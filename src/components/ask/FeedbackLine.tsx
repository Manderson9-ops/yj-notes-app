// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
/** 설정 화면의 한 줄: 「최근 7일 의견: 👍 N · 👎 N · 메모 N」(숫자는 API 값). 이모지는 보조고 글로도 읽힌다. */
export function FeedbackLine({ up, down, notes }: { up: number; down: number; notes: number }) {
  return (
    <p className="muted" data-testid="ask-feedback-7d">
      최근 7일 의견: <span aria-hidden="true">👍</span>
      <span className="sr-only">도움이 됐어요</span> {up} · <span aria-hidden="true">👎</span>
      <span className="sr-only">도움이 안 됐어요</span> {down} · 메모 {notes}
    </p>
  );
}
