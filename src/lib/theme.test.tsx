import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { THEMES, THEME_KEY, initTheme, isThemeId, useTheme } from "./theme";

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
  delete document.documentElement.dataset.theme;
  light = addMeta("(prefers-color-scheme: light)", "#ffffff");
  dark = addMeta("(prefers-color-scheme: dark)", "#121316");
});

afterEach(() => {
  light.remove();
  dark.remove();
});

describe("theme", () => {
  it("lists basic, crayon, forest", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["basic", "crayon", "forest"]);
    expect(THEMES.map((t) => t.label)).toEqual(["기본", "크레용", "숲"]);
    expect(isThemeId("forest")).toBe(true);
    expect(isThemeId("neon")).toBe(false);
  });

  it("initTheme without a saved value leaves no data-theme", () => {
    initTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("initTheme applies a saved theme and its theme-color", () => {
    localStorage.setItem(THEME_KEY, "forest");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(light.content).toBe("#f6f1e3");
    expect(dark.content).toBe("#121b1a");
  });

  it("falls back to basic for an invalid saved value", () => {
    localStorage.setItem(THEME_KEY, "<script>");
    initTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("basic");
  });

  it("useTheme switches, saves, and basic removes the attribute", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("basic");
    act(() => {
      result.current[1]("crayon");
    });
    expect(result.current[0]).toBe("crayon");
    expect(localStorage.getItem(THEME_KEY)).toBe("crayon");
    expect(document.documentElement.dataset.theme).toBe("crayon");
    expect(light.content).toBe("#fffdf5");
    act(() => {
      result.current[1]("basic");
    });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(dark.content).toBe("#121316");
  });
});
