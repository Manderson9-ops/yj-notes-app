import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { logsKey } from "../lib/logs/keys";
import { onSent, startQueueSync } from "../lib/logs/queue";

/** 로그인된 동안 오프라인 대기열을 돌린다(화면 없음). 보낸 뒤에는 기록 목록·요약을 다시 읽는다. */
export function QueueSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const off = onSent(() => {
      void qc.invalidateQueries({ queryKey: logsKey });
    });
    const stop = startQueueSync();
    return () => {
      off();
      stop();
    };
  }, [qc]);
  return null;
}
