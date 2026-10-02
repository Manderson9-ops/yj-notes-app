// 숲 테마 정적 텍스처 생성기: feTurbulence 로 만든 마스크·종이 결을 PNG 로 한 번만 구워 둔다.
// 이유: CSS 마스크·배경에 feTurbulence/feDisplacementMap 이 든 SVG data URI 를 쓰면 브라우저가 그리는 쪽에서
// 필터를 계산해야 해 저사양·소프트웨어 렌더에서 비싸다(docs/design/theme-system.md "렌더 비용 규칙").
// 사용: node tools/perf/make-forest-textures.ts  → public/icons/tex-forest-*.png (가드 G2 허용 경로)
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const blob = (
  w: number,
  h: number,
  freq: string,
  seed: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><filter id="w" x="-40%" y="-60%" width="180%" height="220%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="46" result="d"/><feGaussianBlur in="d" stdDeviation="11"/></filter><g filter="url(#w)"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" fill-opacity=".5"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#000" stroke-width="4" stroke-opacity=".55"/></g></svg>`;

const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

const jobs: [string, number, number, string][] = [
  ["tex-forest-blob-a", 300, 120, blob(300, 120, ".014 .026", 4, 150, 60, 96, 26)],
  ["tex-forest-blob-b", 300, 120, blob(300, 120, ".02 .03", 9, 140, 56, 90, 30)],
  ["tex-forest-grain", 180, 180, grain],
];

const browser = await chromium.launch();
for (const [name, w, h, svg] of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const png = await page.screenshot({ omitBackground: true, type: "png" });
  await writeFile(`public/icons/${name}.png`, png);
  console.log(name, png.length);
  await page.close();
}
await browser.close();
