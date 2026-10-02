// TH-8: 화면 코드는 테마를 모른다. 테마 id 를 아는 곳은 lib/theme.ts, decor/ThemeDecor, CSS 뿐이다.
const sources = {
  ...import.meta.glob("./pages/**/*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("./app/**/*.tsx", { query: "?raw", import: "default", eager: true }),
  // components/ 바로 아래 파일(decor/ 하위는 제외)
  ...import.meta.glob("./components/*.tsx", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

const RE_ATTR = /data-theme/;
const RE_CRAYON = /["'`]crayon["'`]/;
const FORBIDDEN = [RE_ATTR, RE_CRAYON, /["'`]forest["'`]/, /dataset\.theme/];

describe("TH-8 화면 코드에 테마 분기 없음", () => {
  const files = Object.entries(sources).filter(([name]) => !/\.test\.tsx?$/.test(name));

  it("검사 대상이 비어 있지 않다(글롭 오류 방지)", () => {
    const names = files.map(([n]) => n);
    expect(names).toContain("./pages/DesignPreview.tsx");
    expect(names).toContain("./app/AppShell.tsx");
    expect(names).toContain("./components/ThemePicker.tsx");
    expect(names.some((n) => n.includes("/decor/"))).toBe(false);
  });

  it.each(files)("%s", (_name, code) => {
    for (const re of FORBIDDEN) expect(code, String(re)).not.toMatch(re);
  });

  it("대조군: 금지 패턴이 실제로 잡힌다", () => {
    expect('if (theme === "crayon") {}').toMatch(RE_CRAYON);
    expect('<div data-theme="x" />').toMatch(RE_ATTR);
  });
});
