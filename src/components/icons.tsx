import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon() {
  return (
    <Icon>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
    </Icon>
  );
}

export function LogIcon() {
  return (
    <Icon>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </Icon>
  );
}

export function NoteIcon() {
  return (
    <Icon>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h7" />
    </Icon>
  );
}

export function LibraryIcon() {
  return (
    <Icon>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 5v16M9 8h6" />
    </Icon>
  );
}

export function SettingsIcon() {
  return (
    <Icon>
      {/* 조절 막대(슬라이더): 해·톱니처럼 보이지 않게 */}
      <path d="M3 7h9M18 7h3M3 17h3M12 17h9" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </Icon>
  );
}

export function BackspaceIcon() {
  return (
    <Icon>
      <path d="M9 5h11v14H9l-6-7z" />
      <path d="m12.5 9.5 5 5m0-5-5 5" />
    </Icon>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <Icon width={size} height={size} strokeWidth="3" className="chip-check">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  );
}

export function InfoIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" />
    </Icon>
  );
}

export function WarnIcon() {
  return (
    <Icon>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 10v5M12 17.5h.01" />
    </Icon>
  );
}

export function AlertIcon() {
  return (
    <Icon>
      <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" />
      <path d="M12 8v5M12 16h.01" />
    </Icon>
  );
}

export function OkIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </Icon>
  );
}
