// 크레용 장식 글꼴에 없는 글자를 쓰는 공유·복사 버튼은 본문 글꼴로 통일한다(글꼴 섞임 방지 회귀 시험).
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readCss = (): string =>
  readFileSync(join(process.cwd(), "src/styles/ask.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe(".ask-bodyfont", () => {
  it("본문 글꼴 + 굵기 700 규칙이 있어요", () => {
    const css = readCss();
    const m = /:root:root \.btn\.ask-bodyfont\s*\{([^}]*)\}/.exec(css);
    expect(m, "규칙이 지워졌어요").not.toBeNull();
    expect(m?.[1]).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(m?.[1]).toMatch(/font-weight:\s*700/);
  });
  it("선명하게 보기 주 버튼 규칙은 테마 속성 없이(기본 테마 포함) 걸려요", () => {
    const high = readFileSync(join(process.cwd(), "src/styles/contrast-high.css"), "utf8");
    expect(high).toContain(':root[data-contrast="high"] .btn-primary:not(:disabled)');
  });
});
