import { useSyncExternalStore } from "react";
import { useQueueCounts } from "../lib/logs/queue";

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

/** docs/06 §4. 대기 건수는 기록 대기열(src/lib/logs/queue.ts)에서 온다. */
export function OfflineBanner() {
  const online = useOnline();
  const { pending } = useQueueCounts();
  if (online && pending === 0) return null;
  const count = pending > 0 ? ` (대기 ${String(pending)}건)` : "";
  return (
    <div className="offline-banner" role="status">
      {online
        ? `기록 ${String(pending)}건을 보내는 중이에요`
        : `오프라인 — 기록은 저장해 두었다가 연결되면 보내요${count}`}
    </div>
  );
}
