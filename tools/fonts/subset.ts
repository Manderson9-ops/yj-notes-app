// 장식 폰트 부분 집합 만들기 (docs/design/theme-system.md §4, ADR-0007).
//   npm run fonts:subset
// src/ 의 (테스트가 아닌) 소스에서 한글 글자를 모아 + ASCII + 숫자만 남긴 woff2 를 public/fonts/ 에 쓴다.
// 원본 TTF 는 .cache/fonts/ 에 내려받는다(gitignore). 정적 UI 문구를 바꿨으면 다시 실행해 커밋한다.
// 빠진 글자는 시스템 글꼴로 보일 뿐 깨지지 않는다(그래서 눈에 안 띈다: tools/fonts/subset.test.ts 가 목록 누락을 잡는다).
// 쓴 글자 목록은 tools/fonts/display-chars.txt 에 함께 커밋한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { collectHangul, walk } from "./collect.ts";

/** 부분 집합에 넣은 한글 목록(커밋한다). 단위 시험이 「src 의 화면 한글 ⊆ 이 목록」 을 확인한다. */
export const CHARS_FILE = "tools/fonts/display-chars.txt";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(ROOT, "src");
const CACHE = join(ROOT, ".cache", "fonts");
const OUT = join(ROOT, "public", "fonts");
const RAW = "https://raw.githubusercontent.com/google/fonts/main/ofl";
const MAX_BYTES = 80 * 1024;

interface Job {
  family: string; // google/fonts ofl 디렉터리
  ttf: string;
  out: string;
}

const JOBS: readonly Job[] = [
  { family: "jua", ttf: "Jua-Regular.ttf", out: "yj-crayon-display.woff2" },
  { family: "gowunbatang", ttf: "GowunBatang-Bold.ttf", out: "yj-forest-display.woff2" },
];

function ascii(): string {
  let s = "";
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
  return s;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${String(res.status)}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const hangul = collectHangul(walk(SRC));
  const text = hangul + ascii();
  writeFileSync(join(ROOT, CHARS_FILE), `${hangul}\n`);
  console.log(`글자 ${String(hangul.length)}개(한글) + ASCII`);
  for (const job of JOBS) {
    const ttf = join(CACHE, job.ttf);
    if (!existsSync(ttf)) await download(`${RAW}/${job.family}/${job.ttf}`, ttf);
    const ofl = join(OUT, `${job.family}-OFL.txt`);
    if (!existsSync(ofl)) await download(`${RAW}/${job.family}/OFL.txt`, ofl);
    const woff2 = await subsetFont(readFileSync(ttf), text, { targetFormat: "woff2" });
    if (woff2.byteLength > MAX_BYTES) {
      throw new Error(`${job.out} ${String(woff2.byteLength)}B > ${String(MAX_BYTES)}B (TH-6)`);
    }
    writeFileSync(join(OUT, job.out), woff2);
    console.log(`${relative(ROOT, join(OUT, job.out))}  ${String(woff2.byteLength)} B`);
  }
}

if (import.meta.main) await main();
