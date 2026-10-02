import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 초기 번들 규칙(docs/08 Q-PERF): 첫 화면(src/main.tsx 에서 정적 import 로 닿는 파일)은 무거운 것을 끌어오지 않는다.
// 무거운 것은 React.lazy / import() 뒤에 둔다. 이 시험이 실패하면 그 import 를 lazy 로 옮기세요.
const SRC = resolve(import.meta.dirname, "..");
const FORBIDDEN_PACKAGES = ["zod"];
const FORBIDDEN_FILES = [
  "lib/logs/queue",
  "lib/logs/schemas",
  "pages/DesignPreview",
  "pages/SettingsPage",
  "pages/HomePage",
  "pages/NotesPage",
  "features/library",
];

const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function resolveFile(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const p of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (/\.(ts|tsx)$/.test(p) && existsSync(p)) return p;
  }
  return null; // css 등
}

function entryGraph(): { files: string[]; packages: Set<string> } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [join(SRC, "main.tsx")];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    if (seen.has(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(STATIC_IMPORT)) {
      const spec = m[1] ?? m[2] ?? "";
      if (spec.startsWith(".")) {
        const next = resolveFile(f, spec);
        if (next) queue.push(next);
      } else {
        packages.add(spec.split("/")[0] ?? spec);
      }
    }
  }
  return { files: [...seen].map((p) => p.slice(SRC.length + 1).replaceAll("\\", "/")), packages };
}

describe("초기 번들(첫 화면)이 끌어오는 것", () => {
  const { files, packages } = entryGraph();

  it("그래프를 실제로 읽었다(빈 결과로 통과하지 않는다)", () => {
    expect(files).toContain("main.tsx");
    expect(files).toContain("app/App.tsx");
    expect(files).toContain("pages/PinScreen.tsx");
    expect(packages.has("react")).toBe(true);
  });

  it("무거운 패키지(zod)는 들어 있지 않다", () => {
    for (const p of FORBIDDEN_PACKAGES) expect(packages.has(p), `${p} 는 lazy 뒤에`).toBe(false);
  });

  it("lazy 로 둔 화면·대기열 코드는 정적으로 닿지 않는다", () => {
    for (const bad of FORBIDDEN_FILES) {
      const hit = files.filter((f) => f.startsWith(bad));
      expect(hit, `${bad} 는 React.lazy / import() 로만`).toEqual([]);
    }
  });
});
