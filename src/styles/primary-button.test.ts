// 주 버튼(.btn-primary)은 모든 테마·선명하게 보기에서 보조 버튼(.btn)과 테두리 색 말고도 면·글자색이 달라야 한다.
// 「.btn.btn-primary」 두 클래스를 함께 쓰는 곳(물어보기 등)에서 테마의 .btn 규칙이 이기는 사고(숲 테마)를 막는다.
// 대비 수치 자체(on-accent / accent ≥ 7:1, 선명하게 보기)는 contrast.test.ts 가 맡는다.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 목록이 정확히 sel 인 규칙의 본문들. */
function bodies(css: string, sel: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const list = (m[1] ?? "").split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (list.includes(sel)) out.push(m[2] ?? "");
  }
  return out;
}

describe("주 버튼 면·글자색", () => {
  it("공용: 강조색 면 + on-accent 글자", () => {
    const b = bodies(read("./components.css"), ".btn-primary").join(";");
    expect(b).toMatch(/background:\s*var\(--c-accent\)/);
    expect(b).toMatch(/color:\s*var\(--c-on-accent\)/);
  });

  for (const theme of ["crayon", "forest"]) {
    it(`${theme}: .btn 규칙이 있어도 .btn-primary 가 같은 명시도로 면·글자색을 다시 정한다`, () => {
      const css = read(`./themes/${theme}.css`);
      const sel = `:root[data-theme="${theme}"] .btn-primary`;
      const b = bodies(css, sel).join(";");
      expect(b, sel).toMatch(/background(?:-color)?:\s*var\(--(?:c-accent|face)\)/);
      expect(b, sel).toMatch(/color:\s*var\(--c-on-accent\)/);
      // 보조 버튼과 면이 같지 않다
      const sec = bodies(css, `:root[data-theme="${theme}"] .btn`).join(";");
      expect(sec).toMatch(/var\(--c-surface\)/);
    });
  }

  it("선명하게 보기: 모든 테마에서 .btn-primary(꺼지지 않은) 가 강조색 면 + on-accent 글자", () => {
    const b = bodies(
      read("./contrast-high.css"),
      ':root[data-contrast="high"][data-theme] .btn-primary:not(:disabled)',
    ).join(";");
    expect(b).toMatch(/background-color:\s*var\(--c-accent\)/);
    expect(b).toMatch(/color:\s*var\(--c-on-accent\)/);
    expect(b).toMatch(/border-color:\s*var\(--c-accent\)/);
  });
});
