import { useEffect, useState, type ComponentType } from "react";
import { QuietBoundary } from "../components/QuietBoundary";

type Loader = () => Promise<{ default: ComponentType }>;

const defaultLoad: Loader = () =>
  import("../components/QueueSync").then((m) => ({ default: m.QueueSync }));

/**
 * 오프라인 대기열 동기화(QueueSync)를 필요할 때 내려받아 켠다. 연결이 끊긴 채 내려받기에 실패해도 앱은 멈추지 않고,
 * 연결이 돌아오거나(online) 화면이 다시 보일 때(visibilitychange) 새로 내려받아 다시 시도한다(조용히 꺼진 채로 두지 않는다).
 */
export function QueueSyncGate({ load = defaultLoad }: { load?: Loader }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [Sync, setSync] = useState<ComponentType | null>(null);

  useEffect(() => {
    let alive = true;
    load().then(
      (m) => {
        if (alive) setSync(() => m.default);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt, load]);

  useEffect(() => {
    if (!failed) return;
    const retry = () => {
      if (document.visibilityState === "hidden") return;
      setFailed(false);
      setAttempt((n) => n + 1);
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [failed]);

  return Sync ? (
    <QuietBoundary>
      <Sync />
    </QuietBoundary>
  ) : null;
}
