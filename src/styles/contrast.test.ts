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
      if (selector.startsWith("@media") || selector.startsWith("@keyframes")) {
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
  "--c-shadow",
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
  "--fs-sm",
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
// ---- 배경 층(워시·종이 결·수채 번짐) 위 글자 대비 ----
type Rgb = [number, number, number];

function toRgb(hexColor: string): Rgb {
  const h = hexColor.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  return [0, 2, 4].map((o) => parseInt(full.slice(o, o + 2), 16)) as Rgb;
}

function toHex(c: Rgb): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** top 색(알파 a)을 base 위에 합성한 색. */
function over(top: Rgb, a: number, base: Rgb): Rgb {
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (base[i] ?? 0) * (1 - a)) as Rgb;
}

/** `--tex-bg` 값에서 알파 > 0 인 색 정지점(rgba / #hex)을 읽는다. */
function parseStops(value: string): { rgb: Rgb; a: number }[] {
  const re =
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
  const out: { rgb: Rgb; a: number }[] = [];
  for (const m of value.matchAll(re)) {
    const stop =
      m[1] !== undefined
        ? {
            rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb,
            a: m[4] === undefined ? 1 : Number(m[4]),
          }
        : { rgb: toRgb(m[0]), a: 1 };
    if (stop.a > 0) out.push(stop);
  }
  return out;
}

// 종이 결(feTurbulence 회색조 SVG) 한 장의 실측: 캔버스에 그려 픽셀별 a*(1-v)(검정으로 덮는 정도)와
// a*v(흰색으로 덮는 정도)의 최댓값을 구했다(2026-10-02, 180×180 타일). 최악 지점 대비 계산에 쓴다.
const GRAIN_MAX_DARKEN = 0.354;
const GRAIN_MAX_LIGHTEN = 0.727;

const WASH_PAIRS: [string, number][] = [
  ["--c-fg", 4.5],
  ["--c-muted", 4.5],
  ["--c-link", 4.5],
  ["--c-earth", 4.5],
  ["--c-accent", 4.5],
  ["--c-border", 3],
];

/** 글자가 올라갈 수 있는 배경 후보: bg, 워시 정지점 각각(bg 위 최대 알파), 모두 쌓은 경우, 거기에 종이 결 최악. */
export function backdrops(
  tokens: Map<string, string>,
  scheme: Scheme,
  grainOpacity: number,
): { label: string; rgb: Rgb }[] {
  const bg = toRgb(hex(tokens, "--c-bg"));
  const stops = parseStops(tokens.get("--tex-bg") ?? "");
  const list: { label: string; rgb: Rgb }[] = [{ label: "bg", rgb: bg }];
  for (const s of stops)
    list.push({ label: `wash ${toHex(s.rgb)}@${String(s.a)}`, rgb: over(s.rgb, s.a, bg) });
  if (stops.length > 1) {
    list.push({
      label: "wash stacked",
      rgb: stops.reduceRight((acc, s) => over(s.rgb, s.a, acc), bg),
    });
  }
  if (grainOpacity > 0) {
    const grain: [Rgb, number] =
      scheme === "light"
        ? [[0, 0, 0], grainOpacity * GRAIN_MAX_DARKEN]
        : [[255, 255, 255], grainOpacity * GRAIN_MAX_LIGHTEN];
    for (const b of [...list])
      list.push({ label: `${b.label}+grain`, rgb: over(grain[0], grain[1], b.rgb) });
  }
  return list;
}

/** 워시·결 위에서 기준 미달인 (글자색, 배경) 설명 목록. */
export function washFailures(
  tokens: Map<string, string>,
  scheme: Scheme,
  grainOpacity: number,
): string[] {
  const out: string[] = [];
  for (const b of backdrops(tokens, scheme, grainOpacity)) {
    for (const [fg, min] of WASH_PAIRS) {
      const r = ratio(hex(tokens, fg), toHex(b.rgb));
      if (r < min)
        out.push(`${fg} on ${b.label} ${toHex(b.rgb)} = ${r.toFixed(2)} < ${String(min)}`);
    }
  }
  return out;
}

/** 수채 번짐(하늘 `--blob-alpha` + 숲색 `--blob-alpha-2`, 마스크 최대 알파 1 가정) 위 글자(fg·muted) 대비.
 *  번짐이 놓이는 바탕(--c-surface-2 헤더·빈 상태, --c-bg PIN)마다 단독/겹침을 모두 본다. 번짐이 없는 테마는 빈 목록. */
export function blobFailures(tokens: Map<string, string>): string[] {
  const a1 = Number(tokens.get("--blob-alpha"));
  if (!a1) return [];
  const a2 = Number(tokens.get("--blob-alpha-2") ?? 0);
  const sky = toRgb(hex(tokens, "--c-deco-1"));
  const green = sky; // 두 번째 번짐도 하늘색(진하기만 다름)
  const out: string[] = [];
  for (const baseKey of ["--c-surface-2", "--c-bg"]) {
    const base = toRgb(hex(tokens, baseKey));
    const skyOn = over(sky, a1, base);
    const cases: [string, Rgb][] = [
      ["sky", skyOn],
      ["sky+green", over(green, a2, skyOn)],
    ];
    for (const [label, rgb] of cases) {
      for (const fg of ["--c-fg", "--c-muted"]) {
        const r = ratio(hex(tokens, fg), toHex(rgb));
        if (r < 4.5)
          out.push(`${fg} on blob(${label}) over ${baseKey} ${toHex(rgb)} = ${r.toFixed(2)} < 4.5`);
      }
    }
  }
  return out;
}
/** 테마 전용 쌍(예: 크레용 형광펜 띠 위 글자). */
const THEME_PAIRS: Record<string, [string, string, number][]> = {
  crayon: [["--c-on-hl", "--c-hl", 4.5]],
};

function grainOpacityFor(theme: string, scheme: Scheme): number {
  const css = files[`./themes/${theme}.css`];
  if (!css) return 0;
  const g = collect(css, `:root[data-theme="${theme}"] body::after`);
  const v = (scheme === "light" ? g.light : new Map([...g.light, ...g.dark])).get("opacity");
  return v ? Number(v) : 0;
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

      it("워시·종이 결 위 글자·경계 대비(최진 합성색 기준)", () => {
        const grain = grainOpacityFor(theme, scheme);
        expect(washFailures(t, scheme, grain)).toEqual([]);
        if (process.env.PRINT_WASH) {
          for (const b of backdrops(t, scheme, grain))
            console.log(
              `${theme}/${scheme} ${b.label} ${toHex(b.rgb)} link ${ratio(hex(t, "--c-link"), toHex(b.rgb)).toFixed(2)} fg ${ratio(hex(t, "--c-fg"), toHex(b.rgb)).toFixed(2)} border ${ratio(hex(t, "--c-border"), toHex(b.rgb)).toFixed(2)}`,
            );
        }
      });

      it("수채 번짐 위 글자 대비", () => {
        expect(blobFailures(t)).toEqual([]);
      });

      it("테마 전용 쌍", () => {
        for (const [fg, bg, min] of THEME_PAIRS[theme] ?? []) {
          expect(ratio(hex(t, fg), hex(t, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
        }
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

  it("워시 대조군: 진한 워시를 얹으면 실패 목록이 나온다", () => {
    const bad = new Map(tokensFor("basic", "light"));
    bad.set(
      "--tex-bg",
      "radial-gradient(100% 50% at 50% 100%, rgba(0, 120, 0, 0.9) 0%, rgba(0, 120, 0, 0) 70%)",
    );
    expect(washFailures(bad, "light", 0).length).toBeGreaterThan(0);
    const ok = new Map(tokensFor("basic", "light"));
    ok.set(
      "--tex-bg",
      "radial-gradient(100% 50% at 50% 100%, rgba(0, 120, 0, 0.05) 0%, rgba(0, 120, 0, 0) 70%)",
    );
    expect(washFailures(ok, "light", 0)).toEqual([]);
  });

  it("번짐 대조군: 진한 번짐은 실패", () => {
    const bad = new Map(tokensFor("forest", "light"));
    bad.set("--blob-alpha", "0.95");
    expect(blobFailures(bad).length).toBeGreaterThan(0);
  });
});
