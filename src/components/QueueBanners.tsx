import { useQueueCounts } from "../lib/logs/queue";

// 오프라인 대기열(src/lib/logs/queue.ts)에서 건수를 읽는 부분. 초기 번들을 줄이려고 OfflineBanner 가 필요할 때만 내려받는다.
// 상태별 문구: 「보내지 않은 기록」 은 이 기기에 남은(서버에 아직 없는) 기록이다(로그아웃 대화상자도 같은 말을 쓴다).

/** 연결이 끊겼을 때 배너 뒷부분. */
export function OfflineTail() {
  const { pending } = useQueueCounts();
  return pending > 0
    ? `보내지 않은 기록 ${String(pending)}건은 연결되면 보내요.`
    : "기록은 저장해 두었다가 연결되면 보내요.";
}

/** 연결돼 있고 보내지 않은 기록이 있을 때만 보이는 배너. */
export function SendingBanner() {
  const { pending } = useQueueCounts();
  if (pending === 0) return null;
  return (
    <div className="offline-banner" role="status">
      보내지 않은 기록 {String(pending)}건을 보내는 중이에요.
    </div>
  );
}
