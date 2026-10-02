import type { ReactNode } from "react";

function I({ children }: { children: ReactNode }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  meal: (
    <>
      <path d="M3 11h18a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8z" />
      <path d="M9 7c0-1.5 1.5-1.5 1.5-3M14 7c0-1.5 1.5-1.5 1.5-3" />
    </>
  ),
  cry: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10h.01M15.5 10h.01M9 16c1-1.2 5-1.2 6 0M8 13v3" />
    </>
  ),
  skin_pick: (
    <>
      <path d="M8 21v-8M12 21V6M16 21v-8M20 21v-6" />
      <path d="M4 21v-5M4 21h16" />
    </>
  ),
  bandage_step: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)" />
      <path d="M10.5 10.5h.01M13.5 13.5h.01" />
    </>
  ),
};

/** 기록 종류 아이콘(글자와 함께 쓴다). 모르는 종류는 점 하나. */
export function LogTypeIcon({ code }: { code: string }) {
  return <I>{ICONS[code] ?? <circle cx="12" cy="12" r="3" />}</I>;
}
