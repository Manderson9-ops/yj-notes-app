import type { ReportMeta } from "./api";

/**
 * 검증 배지: 적재 때 남은 검증 결과가 「미통과」일 때만 보인다.
 * 통과는 모든 문서가 같아 소음이라 숨긴다. 상태 표시일 뿐 평가가 아니다.
 */
export function VerifyBadge({ doc }: { doc: ReportMeta }) {
  if (!doc.sourceCommit || doc.verifyOk) return null;
  return <span className="badge">검증 미통과</span>;
}
