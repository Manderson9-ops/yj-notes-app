// theme-system TH-1 / TH-2: 6 조합(3 테마 × 라이트/다크)의 토큰 대비를 CSS 파일에서 읽어 계산한다.
// T-D1 기준: 일반 모드 본문 12:1·보조/흙색/링크 7:1·경계 3:1·상태색 7:1, 선명하게 보기 본문 15:1·보조 10:1·경계 7:1.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { HIGH_CONTRAST_COLORS, THEMES, THEME_COLORS } from "../lib/theme";

// vitest 는 .css 를 빈 모듈로 바꾸므로 fs 로 직접 읽는다.
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
const files: Record<string, string> = {
  "./tokens.css": read("./tokens.css"),
  "./contrast-high.css": read("./contrast-high.css"),
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

/** 파일에서 규칙의 선언을 모은다. 라이트 = selector, 다크 = darkSelector(<html data-scheme="dark"> 규칙). */
function collect(css: string, selector: string, darkSelector = `${selector}[data-scheme="dark"]`) {
  const blocks = parseBlocks(css);
  const merge = (sel: string) => {
    const m = new Map<string, string>();
    for (const b of blocks) if (b.selector === sel) for (const [k, v] of b.decls) m.set(k, v);
    return m;
  };
  return { light: merge(selector), dark: merge(darkSelector) };
}

const COLOR_TOKENS = [
  "--c-bg",
  "--c-fg",
  "--c-muted",
  "--c-border",
  "--c-line",
  "--c-divider",
  "--c-meta",
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
  "--shake-dist",
  "--shake-dur",
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

/** 일반 모드의 토큰. 다크는 라이트 위에 다크 규칙을 덮어쓴 값(실제 CSS 캐스케이드와 같다). */
function tokensFor(theme: string, scheme: Scheme): Map<string, string> {
  const base = collect(files["./tokens.css"] ?? "", ":root");
  if (theme === "basic") {
    return scheme === "light" ? base.light : new Map([...base.light, ...base.dark]);
  }
  const css = files[`./themes/${theme}.css`] ?? "";
  const t = collect(css, `:root[data-theme="${theme}"]`);
  const merged = scheme === "light" ? t.light : new Map([...t.light, ...t.dark]);
  return new Map([...base.light, ...(scheme === "dark" ? base.dark : []), ...merged]);
}

/** 선명하게 보기 토큰: 일반 토큰 위에 contrast-high.css 를 캐스케이드 순서대로 덮는다(라이트 → 테마 → 다크 → 테마+다크). */
function highTokensFor(theme: string, scheme: Scheme): Map<string, string> {
  const css = files["./contrast-high.css"] ?? "";
  const m = new Map(tokensFor(theme, scheme));
  const sel = ':root[data-contrast="high"]';
  const get = (s: string) => collect(css, s).light;
  const layers = [get(sel)];
  if (theme !== "basic") layers.push(get(`${sel}[data-theme="${theme}"]`));
  if (scheme === "dark") {
    layers.push(get(`${sel}[data-scheme="dark"]`));
    if (theme !== "basic") layers.push(get(`${sel}[data-theme="${theme}"][data-scheme="dark"]`));
  }
  for (const l of layers) for (const [k, v] of l) m.set(k, v);
  return m;
}

function hex(tokens: Map<string, string>, k: string): string {
  const v = tokens.get(k);
  if (!v?.startsWith("#")) throw new Error(`${k} 가 #hex 가 아니거나 없음`);
  return v;
}

const SURFACES = ["--c-bg", "--c-surface", "--c-surface-2"] as const;
const onAll = (fg: string, min: number): [string, string, number][] =>
  SURFACES.map((s): [string, string, number] => [fg, s, min]);

const PAIRS: [string, string, number][] = [
  ...onAll("--c-fg", 12),
  ...onAll("--c-muted", 7),
  ...onAll("--c-earth", 7),
  ...onAll("--c-meta", 7),
  ...onAll("--c-link", 7),
  ...onAll("--c-border", 3),
  // 안 눌리는 카드의 가장자리(--c-line): 바탕·면 위 3:1 (장식 구분선은 --c-divider 로 따로)
  ["--c-line", "--c-bg", 3],
  ["--c-line", "--c-surface", 3],
  ["--c-accent", "--c-bg", 4.5],
  ["--c-accent", "--c-surface", 4.5],
  ["--c-on-accent", "--c-accent", 6.5],
  ["--c-on-accent-soft", "--c-accent-soft", 7],
  ["--c-on-badge", "--c-badge", 7],
  ...["warn", "alert", "ok", "info"].flatMap((s): [string, string, number][] => [
    [`--c-${s}`, `--c-${s}-bg`, 7],
    [`--c-${s}`, "--c-bg", 4.5],
  ]),
];

/** 선명하게 보기(data-contrast="high") 쌍. */
const HIGH_PAIRS: [string, string, number][] = [
  ...onAll("--c-fg", 15),
  ...onAll("--c-muted", 10),
  ...onAll("--c-border", 7),
  ...onAll("--c-line", 3),
  ...onAll("--c-meta", 10),
  ...onAll("--c-link", 7),
  ...onAll("--c-earth", 7),
  ...onAll("--c-accent", 7),
  ["--c-on-accent", "--c-accent", 7],
  ["--c-on-accent-soft", "--c-accent-soft", 10],
  ["--c-on-badge", "--c-badge", 10],
  ["--c-fg", "--c-accent-soft", 10],
  ...["warn", "alert", "ok", "info"].flatMap((s): [string, string, number][] => [
    [`--c-${s}`, `--c-${s}-bg`, 7],
  ]),
];

/** 기준 미달 쌍의 설명 목록(비면 통과). */
function failures(tokens: Map<string, string>, pairs = PAIRS): string[] {
  return pairs.flatMap(([fg, bg, min]) => {
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
  ["--c-fg", 12],
  ["--c-muted", 7],
  ["--c-link", 7],
  ["--c-earth", 7],
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
      for (const [fg, min] of [
        ["--c-fg", 12],
        ["--c-muted", 7],
      ] as const) {
        const r = ratio(hex(tokens, fg), toHex(rgb));
        if (r < min)
          out.push(
            `${fg} on blob(${label}) over ${baseKey} ${toHex(rgb)} = ${r.toFixed(2)} < ${String(min)}`,
          );
      }
    }
  }
  return out;
}
/** 테마 전용 쌍(예: 크레용 형광펜 띠 위 글자). */
const THEME_PAIRS: Record<string, [string, string, number][]> = {
  crayon: [["--c-on-hl", "--c-hl", 7]],
};

function grainOpacityFor(theme: string, scheme: Scheme): number {
  const css = files[`./themes/${theme}.css`];
  if (!css) return 0;
  const g = collect(
    css,
    `:root[data-theme="${theme}"] body::after`,
    `:root[data-theme="${theme}"][data-scheme="dark"] body::after`,
  );
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
          ? collect(files["./tokens.css"] ?? "", ":root")[scheme]
          : collect(files[`./themes/${theme}.css`] ?? "", `:root[data-theme="${theme}"]`)[scheme];

      it("계약의 모든 토큰이 정의됨", () => {
        const missing = COLOR_TOKENS.filter((k) => !own.has(k));
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

for (const theme of THEMES.map((t) => t.id)) {
  for (const scheme of ["light", "dark"] as const) {
    describe(`선명하게 보기: ${theme} / ${scheme}`, () => {
      const t = highTokensFor(theme, scheme);

      it.each(HIGH_PAIRS)("%s / %s ≥ %s", (fg, bg, min) => {
        const r = ratio(hex(t, fg), hex(t, bg));
        expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      });

      it("질감·워시·오프셋 그림자가 없다", () => {
        expect(t.get("--tex-bg")).toBe("none");
        expect(t.get("--tex-surface")).toBe("none");
        expect(t.get("--shadow")).toBe("none");
        expect(t.get("--lift") ?? "none").toBe("none");
        expect(t.get("--bw")).toBe("2px");
      });

      it("theme-color(주소창) 은 선명하게 보기의 --c-bg 와 같다", () => {
        expect(HIGH_CONTRAST_COLORS[scheme]).toBe(hex(t, "--c-bg"));
      });
    });
  }
}

describe("다크 규칙은 data-scheme 로만 정한다", () => {
  it("토큰·테마 파일에 prefers-color-scheme 미디어 쿼리가 없다(밝기는 scheme.ts 가 정함)", () => {
    for (const [name, css] of Object.entries(files)) {
      expect(css.replace(/\/\*[\s\S]*?\*\//g, ""), name).not.toContain("prefers-color-scheme");
    }
  });
});

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
