import { useCallback, useSyncExternalStore } from "react";
import { applyThemeColor } from "./theme";

/** 화면 밝기(밝게/어둡게/시스템에 맞춤). 고른 값은 이 기기에만 저장한다. */
export const SCHEMES = [
  { id: "system", label: "시스템에 맞춤" },
  { id: "light", label: "밝게" },
  { id: "dark", label: "어둡게" },
] as const;

export type SchemePref = (typeof SCHEMES)[number]["id"];
export type EffectiveScheme = "light" | "dark";

export const SCHEME_KEY = "yj.scheme";

export function isSchemePref(value: unknown): value is SchemePref {
  return SCHEMES.some((s) => s.id === value);
}

function read(): SchemePref {
  try {
    const v = localStorage.getItem(SCHEME_KEY);
    return isSchemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemScheme(): EffectiveScheme {
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** 선택값을 실제 적용할 밝기로 바꾼다(system 이면 지금 시스템 설정). */
export function resolveScheme(pref: SchemePref): EffectiveScheme {
  return pref === "system" ? systemScheme() : pref;
}

function apply(pref: SchemePref): void {
  document.documentElement.dataset.scheme = resolveScheme(pref);
  applyThemeColor();
}

const listeners = new Set<() => void>();

/** 첫 렌더 전에 한 번 호출한다(밝기 깜박임 방지). 시스템 설정이 바뀌면 「시스템에 맞춤」일 때만 따라간다. */
export function initScheme(): void {
  apply(read());
  if (typeof window.matchMedia !== "function") return;
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (read() === "system") apply("system");
  });
}

export function useScheme(): [SchemePref, (pref: SchemePref) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "system" as const,
  );
  const set = useCallback((pref: SchemePref) => {
    try {
      localStorage.setItem(SCHEME_KEY, pref);
    } catch {
      /* storage unavailable: setting applies for this page only */
    }
    apply(pref);
    listeners.forEach((l) => {
      l();
    });
  }, []);
  return [value, set];
}
