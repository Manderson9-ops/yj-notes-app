// theme-system TH-1 / TH-2: 6 조합(3 테마 × 라이트/다크)의 토큰 대비를 CSS 파일에서 읽어 계산한다.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { THEMES, THEME_COLORS } from "../lib/theme";

// vitest 는 .css 를 빈 모듈로 바꾸므로 fs 로 직접 읽는다.
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const files: Record<string, string> = {
  "./tokens.css": read("./tokens.css"),
  ...Object.fromEntries(
    THEMES.filter((t) => t.id !== "basic").map((t) => [
      `./themes/${t.id}.css`,
      read(`./themes/${t.id}.css`),
    ]),
  ),
};
interface Block {
  selector: string;
  decls: Map<string, string>;
  children: Block[];
}

function parseBlocks(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  function parseList(): Block[] {
    const out: Block[] = [];
    for (;;) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      if (open === -1 || (close !== -1 && close < open)) {
        i = close === -1 ? src.length : close + 1;
        return out;
      }
      const selector = src.slice(i, open).trim();
      i = open + 1;
      const block: Block = { selector, decls: new Map(), children: [] };
      if (selector.startsWith("@media")) {
        block.children = parseList();
      } else {
        const end = src.indexOf("}", i);
        for (const part of src.slice(i, end).split(";")) {
          const k = part.indexOf(":");
          if (k > 0) block.decls.set(part.slice(0, k).trim(), part.slice(k + 1).trim());
        }
        i = end + 1;
      }
      out.push(block);
    }
  }
  return parseList();
}

const DARK = "@media (prefers-color-scheme: dark)";

/** 파일에서 selector 규칙의 선언(라이트=최상위, 다크=@media dark 안)을 모은다. */
function collect(css: string, selector: string) {
  const blocks = parseBlocks(css);
  const merge = (list: Block[]) => {
    const m = new Map<string, string>();
    for (const b of list) if (b.selector === selector) for (const [k, v] of b.decls) m.set(k, v);
    return m;
  };
  const light = merge(blocks);
  const dark = merge(blocks.filter((b) => b.selector === DARK).flatMap((b) => b.children));
  return { light, dark };
}

const COLOR_TOKENS = [
  "--c-bg",
  "--c-fg",
  "--c-muted",
  "--c-border",
  "--c-line",
  "--c-surface",
  "--c-surface-2",
  "--c-accent",
  "--c-on-accent",
  "--c-accent-soft",
  "--c-on-accent-soft",
  "--c-link",
  "--c-badge",
  "--c-on-badge",
  "--c-earth",
  "--c-deco-1",
  "--c-deco-2",
  "--c-deco-3",
  "--c-cloud",
  "--c-warn",
  "--c-warn-bg",
  "--c-alert",
  "--c-alert-bg",
  "--c-info",
  "--c-info-bg",
  "--c-ok",
  "--c-ok-bg",
];

const OTHER_TOKENS = [
  "--font-body",
  "--font-display",
  "--fs-base",
  "--fs-lg",
  "--fs-xl",
  "--lh-base",
  "--radius",
  "--radius-lg",
  "--bw",
  "--shadow",
  "--shadow-press",
  "--tex-bg",
  "--tex-surface",
  "--ease",
  "--dur",
  "--tap",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
];

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  const ch = [0, 2, 4].map((o) => {
    const v = parseInt(full.slice(o, o + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

type Scheme = "light" | "dark";

function tokensFor(theme: string, scheme: Scheme): Map<string, string> {
  const base = collect(files["./tokens.css"] ?? "", ":root");
  if (theme === "basic") {
    return scheme === "light" ? base.light : new Map([...base.light, ...base.dark]);
  }
  const css = files[`./themes/${theme}.css`] ?? "";
  const t = collect(css, `:root[data-theme="${theme}"]`);
  return scheme === "light" ? t.light : new Map([...t.light, ...t.dark]);
}

function hex(tokens: Map<string, string>, k: string): string {
  const v = tokens.get(k);
  if (!v?.startsWith("#")) throw new Error(`${k} 가 #hex 가 아니거나 없음`);
  return v;
}

const PAIRS: [string, string, number][] = [
  ["--c-fg", "--c-bg", 4.5],
  ["--c-fg", "--c-surface", 4.5],
  ["--c-fg", "--c-surface-2", 4.5],
  ["--c-muted", "--c-bg", 4.5],
  ["--c-muted", "--c-surface", 4.5],
  ["--c-muted", "--c-surface-2", 4.5],
  ["--c-on-accent", "--c-accent", 4.5],
  ["--c-on-accent-soft", "--c-accent-soft", 4.5],
  ["--c-on-badge", "--c-badge", 4.5],
  ["--c-link", "--c-bg", 4.5],
  ["--c-link", "--c-surface", 4.5],
  ["--c-earth", "--c-bg", 4.5],
  ["--c-earth", "--c-surface", 4.5],
  ["--c-accent", "--c-bg", 4.5],
  ["--c-accent", "--c-surface", 4.5],
  ...["warn", "alert", "ok", "info"].flatMap((s): [string, string, number][] => [
    [`--c-${s}`, `--c-${s}-bg`, 4.5],
    [`--c-${s}`, "--c-bg", 4.5],
  ]),
  // TH-2: UI 경계·포커스 링·아이콘
  ["--c-border", "--c-bg", 3],
  ["--c-border", "--c-surface", 3],
];

/** 기준 미달 쌍의 설명 목록(비면 통과). */
function failures(tokens: Map<string, string>): string[] {
  return PAIRS.flatMap(([fg, bg, min]) => {
    const r = ratio(hex(tokens, fg), hex(tokens, bg));
    return r >= min ? [] : [`${fg} on ${bg} = ${r.toFixed(2)} < ${String(min)}`];
  });
}
describe("테마 파일", () => {
  it("THEMES 의 모든 테마가 CSS 를 가진다", () => {
    for (const t of THEMES) {
      if (t.id !== "basic") expect(files[`./themes/${t.id}.css`], t.id).toBeTypeOf("string");
    }
    const onDisk = Object.keys(import.meta.glob("./themes/*.css"))
      .map((f) => f.replace(/^.*\/|\.css$/g, ""))
      .sort();
    expect(onDisk).toEqual(
      THEMES.filter((t) => t.id !== "basic")
        .map((t) => t.id)
        .sort(),
    );
  });
});

for (const theme of THEMES.map((t) => t.id)) {
  for (const scheme of ["light", "dark"] as const) {
    describe(`${theme} / ${scheme}`, () => {
      const t = tokensFor(theme, scheme);
      // 테마 파일은 색 토큰을 라이트·다크 둘 다 스스로 정의해야 한다(상속 금지).
      const own =
        theme === "basic"
          ? t
          : collect(files[`./themes/${theme}.css`] ?? "", `:root[data-theme="${theme}"]`)[scheme];

      it("계약의 모든 토큰이 정의됨", () => {
        const missing = COLOR_TOKENS.filter(
          (k) => !own.has(k) && !(scheme === "dark" && theme === "basic" && t.has(k)),
        );
        expect(missing).toEqual([]);
        expect(OTHER_TOKENS.filter((k) => !t.has(k) && !tokensFor("basic", scheme).has(k))).toEqual(
          [],
        );
      });

      it.each(PAIRS)("%s / %s ≥ %s", (fg, bg, min) => {
        const r = ratio(hex(t, fg), hex(t, bg));
        expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      });

      it("theme-color(주소창) 은 --c-bg 와 같다", () => {
        expect(THEME_COLORS[theme][scheme]).toBe(hex(t, "--c-bg"));
      });
    });
  }
}

describe("대조군: 검사 함수는 낮은 대비를 실제로 잡는다", () => {
  it("낮은 대비 토큰 맵은 실패 목록을 돌려준다", () => {
    const bad = new Map(tokensFor("basic", "light"));
    bad.set("--c-muted", "#bbbbbb");
    bad.set("--c-border", "#e0e0e0");
    const fails = failures(bad);
    expect(fails.some((f) => f.startsWith("--c-muted"))).toBe(true);
    expect(fails.some((f) => f.startsWith("--c-border"))).toBe(true);
  });

  it("정상 토큰 맵은 실패가 없다", () => {
    expect(failures(tokensFor("basic", "light"))).toEqual([]);
  });

  it("hex 가 아닌 토큰은 오류", () => {
    const bad = new Map(tokensFor("basic", "light"));
    bad.set("--c-fg", "rgba(0,0,0,1)");
    expect(() => failures(bad)).toThrow();
  });
});
