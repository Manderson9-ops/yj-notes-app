import { useCallback, useSyncExternalStore } from "react";

/** 화면 테마 (ADR-0007). 이 파일과 decor/ThemeDecor 만 테마 id 를 안다. */
export const THEMES = [
  { id: "basic", label: "기본" },
  { id: "crayon", label: "크레용" },
  { id: "forest", label: "숲" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_KEY = "yj.theme";

/** 주소창·상태바 색(index.html 의 theme-color 두 줄: 라이트/다크). 각 테마 --c-bg 와 같아야 한다(contrast.test.ts 가 확인). */
export const THEME_COLORS: Record<ThemeId, { light: string; dark: string }> = {
  basic: { light: "#ffffff", dark: "#121316" },
  crayon: { light: "#fffdf5", dark: "#1e1a18" },
  forest: { light: "#f6f1e3", dark: "#121b1a" },
};

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

function read(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemeId(v) ? v : "basic";
  } catch {
    return "basic";
  }
}

function applyMeta(theme: ThemeId): void {
  const colors = THEME_COLORS[theme];
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute("media") ?? "";
    meta.content = media.includes("dark") ? colors.dark : colors.light;
  }
}

function apply(theme: ThemeId): void {
  if (theme === "basic") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  applyMeta(theme);
}

const listeners = new Set<() => void>();

/** 첫 렌더 전에 한 번 호출한다(테마 깜박임 방지). */
export function initTheme(): void {
  apply(read());
}

export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "basic" as const,
  );
  const set = useCallback((theme: ThemeId) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable: setting applies for this page only */
    }
    apply(theme);
    listeners.forEach((l) => {
      l();
    });
  }, []);
  return [value, set];
}
