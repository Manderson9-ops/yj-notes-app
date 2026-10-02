import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";
import { parseInline, parseMarkdown, safeHref } from "./mdParse";

const SRC = [
  "# 제목",
  "",
  "## 첫째",
  "",
  "문단 **굵게** 와 `코드` 와 [링크](https://example.org/a).",
  "",
  "- 하나",
  "- 둘",
  "",
  "| 가 | 나 |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "<script>alert(1)</script>",
  "",
  "## 둘째",
  "",
  "> 인용",
].join("\n");

describe("parseMarkdown", () => {
  it("builds blocks and gives headings stable ids", () => {
    const blocks = parseMarkdown(SRC);
    expect(blocks.map((b) => b.t)).toEqual(["h", "h", "p", "ul", "table", "p", "h", "quote"]);
    expect(blocks.flatMap((b) => (b.t === "h" ? [b.id] : []))).toEqual(["sec-0", "sec-1", "sec-2"]);
  });

  it("handles fences, ordered lists, CRLF and an unclosed fence", () => {
    const b = parseMarkdown("1. a\r\n2. b\r\n\r\n```\r\ncode\r\nmore");
    expect(b).toEqual([
      { t: "ol", items: ["a", "b"] },
      { t: "code", text: "code\nmore" },
    ]);
  });
});

describe("links and inline", () => {
  it("only http(s) and mailto become links", () => {
    expect(safeHref("https://example.org/x")).toBe("https://example.org/x");
    expect(safeHref("mailto:a@example.org")).toBe("mailto:a@example.org");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
    expect(parseInline("[x](javascript:alert)")).toEqual([{ t: "text", text: "x" }]);
    expect(parseInline("![그림](https://example.org/a.png)")).toEqual([
      { t: "text", text: "그림" },
    ]);
  });
});

describe("<Markdown>", () => {
  it("renders raw HTML as text, never as elements; links get rel=noopener", () => {
    const { container } = render(<Markdown blocks={parseMarkdown(SRC)} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    const a = screen.getByRole("link", { name: /링크/ });
    expect(a).toHaveAttribute("href", "https://example.org/a");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(a).toHaveAttribute("target", "_blank");
    // `#` 는 쪽 제목(h1)과 겹치지 않게 h2 로 그려진다
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelector("#sec-1")?.tagName).toBe("H2");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
