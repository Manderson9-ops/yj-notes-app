import { useCallback, useSyncExternalStore } from "react";
import { applyThemeColor } from "./theme";

/** 선명하게 보기(고대비 모드). 켜면 <html data-contrast="high">. 이 기기에만 저장한다. */
export const CONTRAST_KEY = "yj.contrast";

function read(): boolean {
  try {
    return localStorage.getItem(CONTRAST_KEY) === "high";
  } catch {
    return false;
  }
}

function apply(on: boolean): void {
  if (on) document.documentElement.dataset.contrast = "high";
  else delete document.documentElement.dataset.contrast;
  applyThemeColor();
}

const listeners = new Set<() => void>();

/** 첫 렌더 전에 한 번 호출한다. */
export function initContrast(): void {
  apply(read());
}

export function useContrast(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => false,
  );
  const set = useCallback((on: boolean) => {
    try {
      localStorage.setItem(CONTRAST_KEY, on ? "high" : "normal");
    } catch {
      /* storage unavailable: setting applies for this page only */
    }
    apply(on);
    listeners.forEach((l) => {
      l();
    });
  }, []);
  return [value, set];
}
