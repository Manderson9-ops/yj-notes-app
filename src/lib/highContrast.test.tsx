import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CONTRAST_KEY, initContrast, useContrast } from "./highContrast";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.contrast;
});

describe("highContrast", () => {
  it("is off by default", () => {
    initContrast();
    expect(document.documentElement.dataset.contrast).toBeUndefined();
    const { result } = renderHook(() => useContrast());
    expect(result.current[0]).toBe(false);
  });

  it("initContrast applies a saved high value", () => {
    localStorage.setItem(CONTRAST_KEY, "high");
    initContrast();
    expect(document.documentElement.dataset.contrast).toBe("high");
  });

  it("ignores unknown saved values", () => {
    localStorage.setItem(CONTRAST_KEY, "extreme");
    initContrast();
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });

  it("switching on and off saves and toggles the attribute", () => {
    const { result } = renderHook(() => useContrast());
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(CONTRAST_KEY)).toBe("high");
    expect(document.documentElement.dataset.contrast).toBe("high");
    act(() => {
      result.current[1](false);
    });
    expect(localStorage.getItem(CONTRAST_KEY)).toBe("normal");
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });

  it("theme-color switches to the high-contrast background", () => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    document.head.append(m);
    document.documentElement.dataset.scheme = "dark";
    const { result } = renderHook(() => useContrast());
    act(() => {
      result.current[1](true);
    });
    expect(m.content).toBe("#0b0b0c");
    act(() => {
      result.current[1](false);
    });
    expect(m.content).toBe("#121316");
    m.remove();
    delete document.documentElement.dataset.scheme;
  });
});
