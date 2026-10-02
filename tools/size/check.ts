// 번들 한도 검사(TH-6, Q-PERF). 한도는 하나로 통일한다(임시 여유값 없음):
//   1) 초기 로드(index.html 이 직접 부르는 JS+CSS, gzip) <= main 기준값 + 20 KB
//   2) 전체 JS(lazy 청크 포함, gzip) <= 200 KB (docs/08 Q-PERF)
//   3) 폰트 woff2 각 파일 <= 80 KiB
// 한도를 넘으면 한도를 늘리지 말고 초기 청크의 것을 React.lazy 로 옮긴다. 측정법: docs/design/theme-system.md §4.
//   npm run build && npm run size:check
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = process.argv[2] ?? "dist";
// 테마 도입 전 main 빌드(index-Qj9rEqG7.js + index-DjmQs9Ld.css)를 이 스크립트로 잰 값(zlib 기본 레벨, 1 KB = 1000 B).
// 주의: Vite 의 "gzip: N kB" 출력과는 약 1% 다르다(두 값을 섞어 비교하지 말 것).
const BASELINE_KB = 119.5;
const BUDGET_KB = 20;
const TOTAL_JS_MAX_KB = 200;
const FONT_MAX_BYTES = 80 * 1024;

function gzipKb(file: string): number {
  return gzipSync(readFileSync(file)).byteLength / 1000;
}

const html = readFileSync(join(DIST, "index.html"), "utf8");
const initial = new Set<string>();
for (const m of html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.(?:js|css))"/g)) {
  if (m[1]) initial.add(m[1]);
}
if (initial.size === 0) {
  console.error("TH-6 실패: index.html 에서 초기 로드 파일을 찾지 못했습니다.");
  process.exit(1);
}
const assets = join(DIST, "assets");
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
const limit = BASELINE_KB + BUDGET_KB;
console.log(
  `초기 로드(entry JS+CSS) 합계 ${total.toFixed(2)} KB (main ${BASELINE_KB.toFixed(2)} KB 대비 ${(total - BASELINE_KB >= 0 ? "+" : "") + (total - BASELINE_KB).toFixed(2)} KB, 한도 +${String(BUDGET_KB)} KB = ${limit.toFixed(2)} KB)`,
);
console.log(
  `전체 JS 합계 ${totalJs.toFixed(2)} KB (한도 ${String(TOTAL_JS_MAX_KB)} KB, docs/08 Q-PERF)`,
);
let failed = false;
if (total > limit) {
  console.error("TH-6 실패: 초기 로드가 한도를 넘었습니다. 초기 청크의 것을 lazy 로 옮기세요.");
  failed = true;
}
if (totalJs > TOTAL_JS_MAX_KB) {
  console.error("Q-PERF 실패: 전체 JS 가 한도를 넘었습니다.");
  failed = true;
}

const fonts = join(DIST, "fonts");
if (existsSync(fonts)) {
  for (const name of readdirSync(fonts)) {
    if (!name.endsWith(".woff2")) continue;
    const bytes = statSync(join(fonts, name)).size;
    console.log(`${name}  ${bytes} B (한도 ${FONT_MAX_BYTES} B)`);
    if (bytes > FONT_MAX_BYTES) {
      console.error(`TH-6 실패: ${name} 이(가) 80 KiB 를 넘었습니다.`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
