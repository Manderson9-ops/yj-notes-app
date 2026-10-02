import type { ReactNode } from "react";
import { AlertIcon, InfoIcon, OkIcon, WarnIcon } from "./icons";

export type NoticeTone = "warn" | "alert" | "info" | "ok";

const ICONS = { warn: WarnIcon, alert: AlertIcon, info: InfoIcon, ok: OkIcon } as const;

/** 안내 상자: 상태색 면 + 아이콘 + 글. 상태 표시일 뿐 판정이 아니다(P1). */
export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  const Icon = ICONS[tone];
  return (
    <div className="notice" data-tone={tone}>
      <Icon />
      <p>{children}</p>
    </div>
  );
}
