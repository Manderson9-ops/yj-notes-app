import { Notice } from "../../components/Notice";
import { ApiError } from "../../lib/api";

/** 불러오기 실패: 이유 + 다음 행동(다시 시도). */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : -1;
  const reason =
    status === 0
      ? "인터넷 연결을 확인해 주세요."
      : status === 503
        ? "오늘 사용량이 많아 잠시 쉬어요. 내일 오전 9시 이후 다시 열어 주세요."
        : status === 404
          ? "찾을 수 없는 자료예요."
          : "불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.";
  return (
    <div className="card-stack" role="alert">
      <Notice tone="warn">{reason}</Notice>
      {status !== 404 && status !== 503 ? (
        <button type="button" className="btn" onClick={onRetry}>
          다시 불러오기
        </button>
      ) : null}
    </div>
  );
}
