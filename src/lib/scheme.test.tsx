import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMES, SCHEME_KEY, initScheme, isSchemePref, resolveScheme, useScheme } from "./scheme";
import { THEME_KEY, initTheme } from "./theme";

type Listener = () => void;
let systemDark = false;
let listeners: Listener[] = [];

function addMeta(media: string, content: string) {
  const m = document.createElement("meta");
  m.name = "theme-color";
  m.setAttribute("media", media);
  m.content = content;
  document.head.append(m);
  return m;
}

let light: HTMLMetaElement;
let dark: HTMLMetaElement;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.scheme;
  delete document.documentElement.dataset.theme;
  systemDark = false;
  listeners = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      get matches() {
        return q.includes("dark") && systemDark;
      },
      media: q,
      addEventListener: (_: string, l: Listener) => listeners.push(l),
      removeEventListener: () => undefined,
    })),
  );
  light = addMeta("(prefers-color-scheme: light)", "#f6f7f9");
  dark = addMeta("(prefers-color-scheme: dark)", "#121316");
});

afterEach(() => {
  light.remove();
  dark.remove();
  vi.unstubAllGlobals();
});

describe("scheme", () => {
  it("lists system, light, dark with Korean labels", () => {
    expect(SCHEMES.map((s) => s.id)).toEqual(["system", "light", "dark"]);
    expect(SCHEMES.map((s) => s.label)).toEqual(["시스템에 맞춤", "밝게", "어둡게"]);
    expect(isSchemePref("dark")).toBe(true);
    expect(isSchemePref("sepia")).toBe(false);
  });

  it("resolves system to the current OS setting", () => {
    expect(resolveScheme("system")).toBe("light");
    systemDark = true;
    expect(resolveScheme("system")).toBe("dark");
    expect(resolveScheme("light")).toBe("light");
  });

  it("initScheme defaults to system and sets data-scheme", () => {
    systemDark = true;
    initScheme();
    expect(document.documentElement.dataset.scheme).toBe("dark");
    expect(dark.content).toBe("#121316");
    expect(light.content).toBe("#121316");
  });

  it("an invalid saved value falls back to system", () => {
    localStorage.setItem(SCHEME_KEY, "sepia");
    initScheme();
    expect(document.documentElement.dataset.scheme).toBe("light");
    const { result } = renderHook(() => useScheme());
    expect(result.current[0]).toBe("system");
  });

  it("an explicit choice wins over the OS and is saved", () => {
    systemDark = true;
    const { result } = renderHook(() => useScheme());
    act(() => {
      result.current[1]("light");
    });
    expect(result.current[0]).toBe("light");
    expect(localStorage.getItem(SCHEME_KEY)).toBe("light");
    expect(document.documentElement.dataset.scheme).toBe("light");
  });

  it("theme-color follows the effective scheme and the theme", () => {
    localStorage.setItem(THEME_KEY, "crayon");
    initTheme();
    const { result } = renderHook(() => useScheme());
    act(() => {
      result.current[1]("dark");
    });
    expect(light.content).toBe("#1b1715");
    expect(dark.content).toBe("#1b1715");
    act(() => {
      result.current[1]("light");
    });
    expect(light.content).toBe("#fffdf5");
    expect(dark.content).toBe("#fffdf5");
  });

  it("follows OS changes only while set to system", () => {
    initScheme();
    expect(document.documentElement.dataset.scheme).toBe("light");
    systemDark = true;
    for (const l of listeners) l();
    expect(document.documentElement.dataset.scheme).toBe("dark");
    localStorage.setItem(SCHEME_KEY, "light");
    systemDark = false;
    for (const l of listeners) l();
    expect(document.documentElement.dataset.scheme).toBe("dark"); // 고정된 밝기는 OS 변화에 안 따른다
  });
});
