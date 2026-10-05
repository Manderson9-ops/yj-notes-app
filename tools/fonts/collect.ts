// 장식 폰트에 넣을 한글 글자 모으기(subset.ts 와 단위 시험이 같이 쓴다). 폰트 라이브러리에 의존하지 않는다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * 한글 음절(가-힣)을 정렬해 모은다. 테스트·목업 파일은 제외.
 * 파일 첫 5줄 안에 `// font-subset: skip` 이 있으면 그 파일도 제외한다: 장식 글꼴(h1·h2·앱 이름, 크레용 테마는 버튼·탭도)에
 * 쓰이지 않는 본문 글(답변 카드 같은 긴 본문)만 든 파일에 쓴다. 제목·버튼 문구가 든 파일에는 쓰지 않는다
 * (빠지면 그 글자는 시스템 글꼴로 보인다). 장식 글꼴 한도(80 KiB)를 지키기 위한 장치다.
 */
export function collectHangul(files: readonly string[]): string {
  const set = new Set<string>();
  for (const f of files) {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
    // 주석 속 한글은 UI 에 나오지 않으므로 뺀다(줄 주석은 줄 시작에서만 인식).
    const source = readFileSync(f, "utf8");
    if (/^\s*\/\/\s*font-subset:\s*skip\b/m.test(source.split("\n").slice(0, 5).join("\n")))
      continue;
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const ch of code) {
      if (ch >= "\uac00" && ch <= "\ud7a3") set.add(ch);
    }
  }
  return [...set].sort().join("");
}
