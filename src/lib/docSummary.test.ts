import { describe, expect, it } from "vitest";
import { docSummary, isDescriptive, summaryOfHtml, summaryOfMarkdown } from "./docSummary";

describe("summaryOfMarkdown", () => {
  it("takes the first descriptive paragraph, skipping headings, tables, lists, fences", () => {
    const src = [
      "# 제목",
      "",
      "| a | b |",
      "| --- | --- |",
      "",
      "- 목록",
      "",
      "```",
      "코드 안의 문단 같은 글",
      "```",
      "",
      "이 문서는 **합성** 설명이다.  긴 설명이 `이어진다`.",
    ].join("\n");
    expect(summaryOfMarkdown(src)).toBe("이 문서는 합성 설명이다. 긴 설명이 이어진다.");
  });
  it("falls back to the first quote and cuts long text with an ellipsis", () => {
    expect(summaryOfMarkdown("# 제목\n\n> 인용으로 시작하는 합성 문서")).toBe(
      "인용으로 시작하는 합성 문서",
    );
    const long = Array.from({ length: 40 }, () => "단어").join(" ");
    const out = summaryOfMarkdown(long) ?? "";
    expect(out.endsWith("…")).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(61);
  });
  it("returns null when nothing usable exists", () => {
    expect(summaryOfMarkdown("# 제목\n\n| a | b |\n| --- | --- |")).toBeNull();
    expect(summaryOfMarkdown("")).toBeNull();
  });
});

describe("summaryOfHtml / docSummary", () => {
  it("ignores style/script/head and reads the first real paragraph", () => {
    const html =
      "<html><head><title>x</title><style>p{color:red}</style></head><body><script>var a=1</script><p>짧음</p><p>본문 &amp; 설명이 이어진다</p></body></html>";
    expect(summaryOfHtml(html)).toBe("본문 & 설명이 이어진다");
    expect(docSummary("html", html)).toBe("본문 & 설명이 이어진다");
    expect(docSummary("markdown", "합성 설명 문단이다.")).toBe("합성 설명 문단이다.");
  });
});

describe("설명이 아닌 문단 건너뛰기", () => {
  it("경로·파일 이름 꼴, 따옴표 조각, 메타 문장은 설명이 아니다", () => {
    for (const bad of [
      "report/sample-file.html 에서 만든다",
      "docs/a/b.md 를 보라",
      "sample.py 가 만든 파일",
      '"짧은 조각" 이라고 했다',
      "「조각」 으로 시작",
      "자동 생성된 문서입니다 고치지 마세요",
      "마지막 갱신: 2020-01-01",
      "출처: 합성 자료",
      "버전 3",
    ])
      expect(isDescriptive(bad), bad).toBe(false);
    for (const good of [
      "이 문서는 합성 설명이다.",
      "아이의 하루를 적는 방법을 소개한다.",
      "표를 읽는 법",
    ])
      expect(isDescriptive(good), good).toBe(true);
  });

  it("그런 문단 다음의 첫 설명 문단을 쓴다", () => {
    const md = [
      "# 제목",
      "",
      "report/sample.html 에서 만들어진 문서",
      "",
      '"조각 따옴표" 로 시작하는 문단',
      "",
      "마지막 갱신: 2020-01-01",
      "",
      "진짜 설명은 여기부터 시작하는 합성 문단이다.",
    ].join("\n");
    expect(summaryOfMarkdown(md)).toBe("진짜 설명은 여기부터 시작하는 합성 문단이다.");
    expect(summaryOfHtml("<p>docs/a.md 를 본다</p><p>보이는 설명 문단이 이어진다</p>")).toBe(
      "보이는 설명 문단이 이어진다",
    );
  });
});
