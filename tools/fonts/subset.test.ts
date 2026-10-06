import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectHangul, walk } from "./collect.ts";

const ROOT = join(import.meta.dirname, "..", "..");

describe("장식 폰트 글자 목록", () => {
  it("collectHangul 은 주석·테스트 파일을 빼고 한글 음절만 정렬해 모은다", () => {
    const dir = join(ROOT, "tools", "fonts");
    expect(collectHangul([join(dir, "collect.ts")])).toBe(""); // 이 파일 본문에는 한글 음절이 주석에만 있다
    expect(collectHangul([join(dir, "subset.test.ts")])).toBe(""); // 테스트 파일은 제외
  });

  it("첫 줄에 font-subset: skip 이 있는 파일은 모으지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-"));
    const skipped = join(dir, "a.ts");
    const kept = join(dir, "b.ts");
    writeFileSync(skipped, `// font-subset: skip\nexport const x = "가나";\n`);
    writeFileSync(kept, `export const y = "다라";\n`);
    expect(collectHangul([skipped, kept])).toBe("다라");
  });

  it("src 의 화면 한글은 모두 부분 집합 글자 목록에 있다", () => {
    const used = collectHangul(walk(join(ROOT, "src")));
    const listed = new Set(
      readFileSync(join(ROOT, "tools/fonts/display-chars.txt"), "utf8").trim(),
    );
    const missing = Array.from(used).filter((ch) => !listed.has(ch));
    expect(
      missing.join(""),
      `장식 글꼴에 없는 글자 ${String(missing.length)}개. \`npm run fonts:subset\` 을 다시 실행해 public/fonts 와 tools/fonts/display-chars.txt 를 함께 커밋하세요`,
    ).toBe("");
  });
});
