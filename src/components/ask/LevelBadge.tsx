// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import { levelInfo } from "../../../shared/ask-levels";
import { AlertIcon, InfoIcon, OkIcon, WarnIcon } from "../icons";

const ICONS = { ok: OkIcon, info: InfoIcon, warn: WarnIcon, alert: AlertIcon } as const;

/**
 * 단계 배지: 숫자 + 제목 + 아이콘. 색(상태 토큰)은 보조일 뿐 색만으로 구분하지 않는다.
 * 1~3 ok · 4~6 info · 7~9 warn · 10 alert (같은 상태색 토큰을 쓴다, 새 색 없음).
 */
export function LevelBadge({ level, compact = false }: { level: number; compact?: boolean }) {
  const info = levelInfo(level);
  const Icon = ICONS[info.band];
  return (
    <span className="ask-level" data-band={info.band} data-compact={compact ? "1" : undefined}>
      <Icon />
      <span className="ask-level-num">단계 {level}</span>
      {!compact && <span className="ask-level-title">{info.title}</span>}
    </span>
  );
}
