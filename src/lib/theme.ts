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
  basic: { light: "#f6f7f9", dark: "#121316" },
  crayon: { light: "#fffdf5", dark: "#1b1715" },
  forest: { light: "#f4efe1", dark: "#111a18" },
};

/** 선명하게 보기 켠 때의 주소창 색(contrast-high.css 의 --c-bg 와 같아야 한다). */
export const HIGH_CONTRAST_COLORS = { light: "#ffffff", dark: "#0b0b0c" } as const;

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

/** 지금 적용 중인 밝기: <html data-scheme> (src/lib/scheme.ts 가 정함), 없으면 시스템 설정. */
function currentScheme(): "light" | "dark" {
  const s = document.documentElement.dataset.scheme;
  if (s === "light" || s === "dark") return s;
  const dark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? "dark" : "light";
}

/** 주소창·상태바 색을 지금 테마 + 지금 밝기에 맞춘다. 두 meta 모두 같은 색으로 둔다(사용자가 시스템과 다른 밝기를 골라도 따라가게). */
export function applyThemeColor(): void {
  const scheme = currentScheme();
  // 선명하게 보기: 바탕이 흰색/검정에 가까운 색으로 바뀌므로 주소창도 맞춘다(contrast-high.css 의 --c-bg)
  const color =
    document.documentElement.dataset.contrast === "high"
      ? HIGH_CONTRAST_COLORS[scheme]
      : THEME_COLORS[read()][scheme];
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = color;
  }
}

function apply(theme: ThemeId): void {
  if (theme === "basic") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  applyThemeColor();
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
