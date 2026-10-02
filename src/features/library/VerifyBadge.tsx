import type { ReportMeta } from "./api";

/** 검증 배지: 적재 때 남은 검증 결과가 있을 때만(원본 커밋 기록이 있을 때). 상태 표시일 뿐 평가가 아니다. */
export function VerifyBadge({ doc }: { doc: ReportMeta }) {
  if (!doc.sourceCommit) return null;
  return <span className="badge">{doc.verifyOk ? "검증 통과" : "검증 미통과"}</span>;
}
