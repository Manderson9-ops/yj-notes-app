// 장식 폰트 부분 집합 만들기 (docs/design/theme-system.md §4, ADR-0007).
//   npm run fonts:subset
// src/ 의 (테스트가 아닌) 소스에서 한글 글자를 모아 + ASCII + 숫자만 남긴 woff2 를 public/fonts/ 에 쓴다.
// 원본 TTF 는 .cache/fonts/ 에 내려받는다(gitignore). 정적 UI 문구를 바꿨으면 다시 실행해 커밋한다.
// 빠진 글자는 시스템 글꼴로 보일 뿐 깨지지 않는다.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

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

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** 한글 음절(가-힣)을 정렬해 모은다. 테스트·목업 파일은 제외. */
export function collectHangul(files: readonly string[]): string {
  const set = new Set<string>();
  for (const f of files) {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
    // 주석 속 한글은 UI 에 나오지 않으므로 뺀다(줄 주석은 줄 시작에서만 인식).
    const code = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const ch of code) {
      if (ch >= "\uac00" && ch <= "\ud7a3") set.add(ch);
    }
  }
  return [...set].sort().join("");
}

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
