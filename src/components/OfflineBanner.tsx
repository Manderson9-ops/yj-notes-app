import { useSyncExternalStore } from "react";

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

/** docs/06 §4. The pending-queue count is added with the offline queue (T-13). */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      오프라인 — 기록은 저장해 두었다가 연결되면 보내요
    </div>
  );
}
