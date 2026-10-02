// 렌더 비용 규칙(docs/design/theme-system.md "렌더 비용 규칙", T-A2):
// 실시간 SVG 필터(feTurbulence 등)와 CSS filter 는 쓰지 않는다 — 요소마다 합성 층·픽셀 계산이 생겨
// 저사양 폰·소프트웨어 렌더(CI 리눅스 webkit)에서 메인 스레드가 멎는다. 결·번짐은 미리 구운 정적 텍스처(PNG·<pattern>)로.
import { readFileSync } from "node:fs";

// vitest 에서 CSS 의 ?raw 는 빈 문자열이라(파이프라인이 비움), 목록만 글롭으로 얻고 파일은 fs 로 읽는다(contrast.test.ts 와 같은 방식).
const css: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob("./**/*.css")).map((n) => [
    n,
    readFileSync(new URL(n, import.meta.url), "utf8"),
  ]),
);
const decor = import.meta.glob<string>("../components/decor/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripJsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** CSS 의 `filter:`/`backdrop-filter:` 선언과 filter 함수(drop-shadow 등). transition 목록의 `filter` 도 잡는다. */
const CSS_FILTER =
  /(^|[;{\s])(-webkit-)?(backdrop-)?filter\s*:|drop-shadow\s*\(|transition[^;]*\bfilter\b/i;
/** SVG 실시간 필터 요소·참조. */
const SVG_FILTER =
  /<filter\b|\bfe(Turbulence|DisplacementMap|GaussianBlur|Morphology|ConvolveMatrix)\b|\bfilter=["'{]/i;

describe("렌더 비용: 실시간 필터 금지", () => {
  it("검사 대상이 비어 있지 않다(글롭 오류 방지)", () => {
    const names = Object.keys(css);
    expect(names).toContain("./themes/crayon.css");
    expect(names).toContain("./themes/forest.css");
    for (const src of Object.values(css)) expect(src.length).toBeGreaterThan(100);
    expect(Object.keys(decor).some((n) => n.endsWith("CrayonDecor.tsx"))).toBe(true);
    expect(Object.keys(decor).some((n) => n.endsWith("ForestDecor.tsx"))).toBe(true);
  });

  it.each(Object.entries(css))("%s 에 CSS filter·SVG 필터(data URI 포함)가 없다", (_n, src) => {
    const code = stripCssComments(src);
    expect(code).not.toMatch(CSS_FILTER);
    expect(code).not.toMatch(SVG_FILTER);
    // data URI 안의 필터도 금지: 브라우저가 그릴 때마다 계산한다. 정적 텍스처는 public/icons/tex-*.png 로 굽는다.
    expect(code).not.toMatch(/feTurbulence|%3Cfilter|<filter/i);
  });

  it.each(Object.entries(decor))("%s 에 SVG 필터가 없다", (_n, src) => {
    expect(stripJsComments(src)).not.toMatch(SVG_FILTER);
  });

  it("대조군: 금지 패턴이 실제로 잡힌다", () => {
    expect("a { filter: drop-shadow(1px 1px 0 #000); }").toMatch(CSS_FILTER);
    expect("a{transition: transform 1s, filter 1s}").toMatch(CSS_FILTER);
    expect("a { box-shadow: 3px 3px 0 #000; }").not.toMatch(CSS_FILTER);
    expect("<filter id='x'><feTurbulence/></filter>").toMatch(SVG_FILTER);
    expect('<g filter="url(#x)">').toMatch(SVG_FILTER);
    expect('<g mask="url(#x)">').not.toMatch(SVG_FILTER);
  });
});
