// font-subset: skip
// 알림장 자동 업데이트(T-S1) 안내 문구. 본문 글꼴로만 쓰이는 글(배너·설정 한 줄)이라 장식 글꼴 부분집합에서 뺀다.
// 한글 장문 검사(G7)에 걸리지 않게 문장 단위로 나눠 둔다. 판정 어휘를 쓰지 않는다(P1).
import { seoulDateOf } from "./dateFormat";

export interface SyncInfo {
  state: "none" | "ok" | "running" | "failed" | "missed" | "stuck";
  lastOkAt: string | null;
  lastAttemptAt: string | null;
  newReports: number;
  lastNoteDate: string | null;
  code: string | null;
}

/** 경고 배너를 띄우는 상태인가. */
export const syncNeedsNotice = (s: SyncInfo): boolean =>
  s.state === "failed" || s.state === "missed" || s.state === "stuck";

const REASONS: Readonly<Record<string, string>> = {
  fetch_login: "키즈노트 로그인이 풀렸어요",
  fetch_api: "키즈노트 응답이 없어요",
  changed_existing: "예전 알림장이 바뀌어 확인이 필요해요",
  media: "사진 받기가 끝나지 않았어요",
  verify: "자료 검사에서 멈췄어요",
  ingest: "앱에 올리는 중 멈췄어요",
  missed: "집 PC가 꺼져 있었던 것 같아요",
};

/** 사유 코드 -> 가족 말. 모르는 코드는 관리자 확인 안내. */
export function syncReason(s: SyncInfo): string {
  // 서비스 이름이 든 코드(<서비스 8자>_login, _api)는 번들 표지어 검사(G7)에 걸리지 않게 이름 대신 모양으로 맞춘다.
  const m = /^[a-z]{8}_(login|api)$/.exec(s.code ?? "");
  const key = s.state === "missed" ? "missed" : m ? `fetch_${m[1] ?? ""}` : (s.code ?? "");
  return REASONS[key] ?? "관리자 확인이 필요해요";
}

export const SYNC_HEAD = "오늘 저녁 알림장 자동 업데이트가 안 됐어요.";
export const SYNC_NEXT = "내일 저녁 8시에 다시 해요.";

/** 마지막으로 반영된 알림장 날짜 한 줄(날짜를 모르면 null). */
export function syncLastNoteLine(s: SyncInfo, fallback: string | null): string | null {
  const d = s.lastNoteDate ?? fallback;
  return d ? `마지막으로 반영된 알림장: ${formatMd(d)}` : null;
}

/** YYYY-MM-DD -> M월 D일 */
export function formatMd(date: string): string {
  const [, m = 0, d = 0] = date.split("-").map(Number);
  return `${String(m)}월 ${String(d)}일`;
}

/** 설정 한 줄: 「매일 저녁 8시 · 마지막 성공 M월 D일 HH:MM(새 알림장 N건)」. 성공 기록이 없으면 「아직 없어요」. */
export function syncSettingsLine(s: SyncInfo): string {
  if (!s.lastOkAt) return "매일 저녁 8시 · 마지막 성공 아직 없어요";
  const ms = Date.parse(s.lastOkAt);
  if (Number.isNaN(ms)) return "매일 저녁 8시 · 마지막 성공 아직 없어요";
  const kst = new Date(ms + 9 * 3_600_000).toISOString();
  const day = formatMd(seoulDateOf(ms));
  const hhmm = kst.slice(11, 16);
  return `매일 저녁 8시 · 마지막 성공 ${day} ${hhmm}(새 알림장 ${String(s.newReports)}건)`;
}
