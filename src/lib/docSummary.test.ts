import { describe, expect, it } from "vitest";
import { docSummary, summaryOfHtml, summaryOfMarkdown } from "./docSummary";

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
