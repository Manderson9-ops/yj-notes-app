import { lazy, Suspense, useSyncExternalStore } from "react";
import { QuietBoundary } from "./QuietBoundary";

// 대기 건수는 기록 대기열에서 오는데, 그 코드는 초기 번들에 넣지 않는다(QueueBanners 를 필요할 때 내려받는다).
const OfflineTail = lazy(() => import("./QueueBanners").then((m) => ({ default: m.OfflineTail })));
const SendingBanner = lazy(() =>
  import("./QueueBanners").then((m) => ({ default: m.SendingBanner })),
);

const NO_COUNT_TAIL = "기록은 저장해 두었다가 연결되면 보내요.";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** docs/06 §4. 끊김: 「오프라인이에요」 + 상태별 뒷말. 연결됨: 보내지 않은 기록이 있을 때만 「보내는 중」. */
export function OfflineBanner() {
  const online = useOnline();
  if (!online) {
    return (
      <div className="offline-banner" role="status">
        오프라인이에요.{" "}
        <QuietBoundary fallback={NO_COUNT_TAIL}>
          <Suspense fallback={NO_COUNT_TAIL}>
            <OfflineTail />
          </Suspense>
        </QuietBoundary>
      </div>
    );
  }
  return (
    <QuietBoundary>
      <Suspense fallback={null}>
        <SendingBanner />
      </Suspense>
    </QuietBoundary>
  );
}
