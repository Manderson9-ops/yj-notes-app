// TH-6: 초기 로드(index.html 이 부르는 entry JS+CSS, gzip) 합계가 기준을 넘으면 실패한다. lazy 청크는 따로 보고 전체 JS <= 200 KB 만 확인한다.
//   npm run build && npm run size:check
// 기준 = 테마 도입 전 main 의 합계(119.50 KB) + 15 KB. 폰트(woff2)는 별도 파일이라 합계에 없다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = process.argv[2] ?? "dist";
// 테마 도입 전 main 빌드(index-Qj9rEqG7.js + index-DjmQs9Ld.css)를 이 스크립트로 잰 값(zlib 기본 레벨, 1 KB = 1000 B).
// 주의: Vite 의 "gzip: N kB" 출력과는 약 1% 다르다(두 값을 섞어 비교하지 말 것).
const BASELINE_KB = 119.5;
const BUDGET_KB = 15;
const TOTAL_JS_MAX_KB = 200; // docs/08 Q-PERF: JS <= 200 KB gzip (lazy 청크 포함)

function gzipKb(file: string): number {
  return gzipSync(readFileSync(file)).byteLength / 1000;
}

const assets = join(DIST, "assets");

// 초기 로드 = index.html 이 직접 부르는 파일(스크립트 src, modulepreload, 스타일시트). lazy 청크(자료 화면 등)는 제외한다.
// 전체 JS = assets 의 모든 .js (docs/08 Q-PERF: JS <= 200 KB gzip).
const html = readFileSync(join(DIST, "index.html"), "utf8");
const initial = new Set<string>();
for (const m of html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)) {
  if (m[1]) initial.add(m[1]);
}
let total = 0;
let totalJs = 0;
for (const name of readdirSync(assets)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const kb = gzipKb(join(assets, name));
  const isInitial = initial.has(name);
  if (isInitial) total += kb;
  if (name.endsWith(".js")) totalJs += kb;
  console.log(`${name}  ${kb.toFixed(2)} KB gzip${isInitial ? "  [초기]" : "  [lazy]"}`);
}
if (initial.size === 0) {
  console.error("TH-6 실패: index.html 에서 초기 로드 파일을 찾지 못했습니다.");
  process.exit(1);
}
const limit = BASELINE_KB + BUDGET_KB;
console.log(
  `초기 로드(entry JS+CSS) 합계 ${total.toFixed(2)} KB (main ${BASELINE_KB.toFixed(2)} KB 대비 ${(total - BASELINE_KB >= 0 ? "+" : "") + (total - BASELINE_KB).toFixed(2)} KB, 한도 +${String(BUDGET_KB)} KB = ${limit.toFixed(2)} KB)`,
);
if (total > limit) {
  console.error("TH-6 실패: 초기 로드 증가가 한도를 넘었습니다.");
  process.exit(1);
}
console.log(
  `전체 JS 합계 ${totalJs.toFixed(2)} KB (한도 ${String(TOTAL_JS_MAX_KB)} KB, docs/08 Q-PERF)`,
);
if (totalJs > TOTAL_JS_MAX_KB) {
  console.error("Q-PERF 실패: 전체 JS 가 한도를 넘었습니다.");
  process.exit(1);
}

// TH-6(폰트): 장식 폰트 woff2 는 파일마다 80 KB(= 81920 B) 이하여야 한다.
const FONT_MAX_BYTES = 80 * 1024;
const fonts = join(DIST, "fonts");
if (existsSync(fonts)) {
  for (const name of readdirSync(fonts)) {
    if (!name.endsWith(".woff2")) continue;
    const bytes = statSync(join(fonts, name)).size;
    console.log(`${name}  ${bytes} B (한도 ${FONT_MAX_BYTES} B)`);
    if (bytes > FONT_MAX_BYTES) {
      console.error(`TH-6 실패: ${name} 이(가) 80 KB 를 넘었습니다.`);
      process.exit(1);
    }
  }
}
