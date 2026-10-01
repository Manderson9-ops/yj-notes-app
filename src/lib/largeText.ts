import { useCallback, useSyncExternalStore } from "react";

const KEY = "yj.largeText";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function apply(on: boolean): void {
  if (on) document.documentElement.dataset.largeText = "1";
  else delete document.documentElement.dataset.largeText;
}

const listeners = new Set<() => void>();

/** Call once at startup, before first render, to avoid a flash of small text. */
export function initLargeText(): void {
  apply(read());
}

export function useLargeText(): [boolean, (on: boolean) => void] {
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
      localStorage.setItem(KEY, on ? "1" : "0");
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
