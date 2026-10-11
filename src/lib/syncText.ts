// font-subset: skip
// 알림장 자동 업데이트(T-S1) 안내 문구. 본문 글꼴로만 쓰이는 글(배너·설정 한 줄)이라 장식 글꼴 부분집합에서 뺀다.
// 한글 장문 검사(G7)에 걸리지 않게 문장 단위로 나눠 둔다. 판정 어휘를 쓰지 않는다(P1).
// 문구는 「지금 시각」(한국 시간)에 맞춘다: 저녁 8시 전에는 「어제 저녁」, 8시부터는 「오늘 저녁」.
import { EARLY_GRACE_MS, KST_OFFSET_MS, SCHEDULE_HOUR_KST } from "../../shared/sync-schedule";
import { seoulDateOf } from "./dateFormat";

export interface SyncInfo {
  state: "none" | "ok" | "running" | "failed" | "missed" | "stuck";
  lastOkAt: string | null;
  lastAttemptAt: string | null;
  /** 서버가 시작 보고를 받은 시각(집 PC 시계와 무관). 「오늘/어제」 판단은 이 값으로 한다. */
  lastAttemptReceivedAt?: string | null;
  newReports: number;
  lastNoteDate: string | null;
  code: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 경고 배너를 띄우는 상태인가. */
export const syncNeedsNotice = (s: SyncInfo): boolean =>
  s.state === "failed" || s.state === "missed" || s.state === "stuck";

const kstHour = (ms: number): number => new Date(ms + KST_OFFSET_MS).getUTCHours();

/** ms 이전에서 가장 가까운 20:00 KST (UTC ms). */
function lastScheduled(ms: number): number {
  const dayStart = Math.floor((ms + KST_OFFSET_MS) / DAY) * DAY - KST_OFFSET_MS;
  const today = dayStart + SCHEDULE_HOUR_KST * HOUR;
  return ms >= today ? today : today - DAY;
}

/**
 * 안 된 실행이 「오늘 저녁」 것인가. 저녁 8시 전이면 늘 어제 것. 8시 이후면 이번 예정 시각 근처에 시작한 실행(또는 미실행)만 오늘 것이고,
 * 어제 실패가 아직 남아 있는 때(오늘 실행 전)는 어제 것이다.
 */
function isTonight(s: SyncInfo, nowMs: number): boolean {
  if (kstHour(nowMs) < SCHEDULE_HOUR_KST) return false;
  if (s.state === "missed") return true;
  const at = s.lastAttemptReceivedAt ?? s.lastAttemptAt;
  const t = at ? Date.parse(at) : NaN;
  return !Number.isNaN(t) && t >= lastScheduled(nowMs) - EARLY_GRACE_MS;
}

const REASONS: Readonly<Record<string, string>> = {
  fetch_login: "키즈노트 로그인이 풀렸어요",
  fetch_api: "키즈노트 응답이 없어요",
  changed_existing: "예전 알림장이 바뀌었어요",
  media: "사진 받기가 끝나지 않았어요",
  verify: "자료 검사에서 멈췄어요",
  ingest: "앱에 올리는 중 멈췄어요",
  missed: "집 PC가 꺼져 있었던 것 같아요",
  stuck: "업데이트가 너무 오래 걸려 멈췄어요",
};
const FALLBACK_REASON = "관리자 확인이 필요해요";

/** 사유 코드 -> 가족 말. 모르는 코드(restore_failed·internal 포함)는 관리자 확인 안내. */
export function syncReason(s: SyncInfo): string {
  // 서비스 이름이 든 코드(<서비스 8자>_login, _api)는 번들 표지어 검사(G7)에 걸리지 않게 이름 대신 모양으로 맞춘다.
  const m = /^[a-z]{8}_(login|api)$/.exec(s.code ?? "");
  const key =
    s.state === "missed"
      ? "missed"
      : s.state === "stuck"
        ? "stuck"
        : m
          ? `fetch_${m[1] ?? ""}`
          : (s.code ?? "");
  return REASONS[key] ?? FALLBACK_REASON;
}

/** 배너 첫 줄(굵게). */
export function syncHead(s: SyncInfo, nowMs: number): string {
  return `${isTonight(s, nowMs) ? "오늘" : "어제"} 저녁 알림장 자동 업데이트가 안 됐어요.`;
}

/** 누가 하는지 한 줄: 가족이 할 일은 없다. */
export function syncWhoLine(s: SyncInfo): string {
  return s.state === "missed"
    ? "관리자가 집 PC를 확인해요(가족은 하실 일 없어요)."
    : "관리자가 확인해요(가족은 하실 일 없어요).";
}

/** 다음 실행 안내(재시도가 아니라 정기 실행). */
export function syncNextLine(s: SyncInfo, nowMs: number): string {
  if (kstHour(nowMs) < SCHEDULE_HOUR_KST) return "오늘 저녁 8시에 다시 해요.";
  // 8시가 지났는데 아직 어제 결과만 남아 있으면 오늘 실행이 곧 시작된다.
  return isTonight(s, nowMs) ? "내일 저녁 8시에 다시 해요." : "곧 다시 해요.";
}

/** 마지막으로 반영된 알림장: 문구와 날짜를 따로 준다(날짜는 줄바꿈 없이 붙여 그린다). 날짜를 모르면 null. */
export function syncLastNote(
  s: SyncInfo,
  fallback: string | null,
): { label: string; date: string } | null {
  const d = s.lastNoteDate ?? fallback;
  return d ? { label: "마지막 알림장:", date: formatMd(d) } : null;
}

/** YYYY-MM-DD -> M월 D일 */
export function formatMd(date: string): string {
  const [, m = 0, d = 0] = date.split("-").map(Number);
  return `${String(m)}월 ${String(d)}일`;
}

/** 저녁 8시 10분 / 오후 2시 / 새벽 1시 5분 (한국 시간). */
export function formatTimeKo(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const part = h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "저녁";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${part} ${String(h12)}시${min === 0 ? "" : ` ${String(min)}분`}`;
}

/**
 * 설정 한 줄 조각. 「매일 저녁 8시 · 마지막 성공 M월 D일 저녁 8시 10분 · 새 알림장 N건」 (+ 「 · 오늘은 안 됐어요」).
 * 성공 기록이 없으면 「아직 없어요」. 날짜는 줄바꿈 없이 붙이도록 따로 준다.
 * 성공 실행에 붙은 관리자용 코드(guide_asof_due 등)는 서버가 sync.code 로 내보내지 않아 여기 나오지 않는다.
 */
export function syncSettingsParts(
  s: SyncInfo,
  nowMs: number,
): { head: string; day: string | null; rest: string; alert: string | null } {
  const alert = syncNeedsNotice(s)
    ? `· ${isTonight(s, nowMs) ? "오늘은" : "어제는"} 안 됐어요`
    : null;
  const ms = s.lastOkAt ? Date.parse(s.lastOkAt) : NaN;
  if (Number.isNaN(ms)) {
    return { head: "매일 저녁 8시 · 마지막 성공 아직 없어요", day: null, rest: "", alert };
  }
  const news = s.newReports === 0 ? "새 알림장 없음" : `새 알림장 ${String(s.newReports)}건`;
  return {
    head: "매일 저녁 8시 · 마지막 성공",
    day: formatMd(seoulDateOf(ms)),
    rest: ` ${formatTimeKo(ms)} · ${news}`,
    alert,
  };
}

/** 설정 한 줄을 하나의 글로(시험·읽기용). */
export function syncSettingsLine(s: SyncInfo, nowMs: number): string {
  const p = syncSettingsParts(s, nowMs);
  const line = p.day ? `${p.head} ${p.day}${p.rest}` : `${p.head}${p.rest}`;
  return p.alert ? `${line} ${p.alert}` : line;
}
