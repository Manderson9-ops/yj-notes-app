// 장식 폰트에 넣을 한글 글자 모으기(subset.ts 와 단위 시험이 같이 쓴다). 폰트 라이브러리에 의존하지 않는다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function walk(dir: string): string[] {
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
