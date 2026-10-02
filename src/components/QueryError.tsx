import { ApiError } from "../lib/api";
import { Notice } from "./Notice";

/** 불러오기 실패 안내: 이유 + 다음 행동(다시 시도). 오프라인(status 0)은 연결 확인을 안내한다. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  let reason = "자료를 불러오지 못했어요.";
  if (error instanceof ApiError) {
    if (error.status === 0) reason = "인터넷 연결을 확인해 주세요.";
    else if (error.status === 404) reason = "찾는 자료가 없어요.";
    else if (error.status === 503)
      reason = "오늘 사용량이 많아 잠시 쉬어요. 내일 오전 9시 이후 다시 해 주세요.";
  }
  return (
    <div role="alert">
      <Notice tone="alert">{reason}</Notice>
      {!(error instanceof ApiError && (error.status === 404 || error.status === 503)) && (
        <button type="button" className="btn" onClick={onRetry}>
          다시 불러오기
        </button>
      )}
    </div>
  );
}
