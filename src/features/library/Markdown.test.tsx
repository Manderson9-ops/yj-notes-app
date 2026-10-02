import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
      {
        t: "ol",
        start: 1,
        items: [
          { text: "a", check: null, sub: [] },
          { text: "b", check: null, sub: [] },
        ],
      },
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
    expect(parseInline("[x](../a.md)")).toEqual([{ t: "text", text: "x" }]);
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

describe("real-document syntax (synthetic samples)", () => {
  it("nests lists by indentation and keeps the ordered start number", () => {
    const b = parseMarkdown("- 가\n  - 가1\n  - 가2\n- 나\n\n3. 셋\n4. 넷");
    expect(b[0]).toMatchObject({
      t: "ul",
      items: [{ text: "가", sub: [{ items: [{ text: "가1" }, { text: "가2" }] }] }, { text: "나" }],
    });
    expect(b[1]).toMatchObject({ t: "ol", start: 3 });
  });

  it("parses checkbox items, continuation lines and hard line breaks", () => {
    const b = parseMarkdown("- [ ] 할 일\n- [x] 한 일\n  이어지는 줄\n\n첫 줄  \n둘째 줄\n셋째 줄");
    expect(b[0]).toMatchObject({
      t: "ul",
      items: [
        { text: "할 일", check: false },
        { text: "한 일 이어지는 줄", check: true },
      ],
    });
    expect(b[1]).toEqual({ t: "p", text: "첫 줄\n둘째 줄 셋째 줄" });
  });

  it("parses <details>/<summary> into a collapsible block with its own blocks", () => {
    const b = parseMarkdown(
      "<details>\n<summary>펼치기</summary>\n\n## 안쪽 제목\n\n- 항목\n\n</details>\n\n## 바깥",
    );
    expect(b[0]).toMatchObject({
      t: "details",
      summary: "펼치기",
      blocks: [{ t: "h", id: "sec-0" }, { t: "ul" }],
    });
    // 제목 번호는 접는 칸 안팎에서 이어진다(id 가 겹치지 않는다)
    expect(b[1]).toMatchObject({ t: "h", id: "sec-1" });
    expect(parseMarkdown("<details><summary>한 줄</summary>내용</details>")[0]).toMatchObject({
      t: "details",
      summary: "한 줄",
      blocks: [{ t: "p", text: "내용" }],
    });
  });

  it("drops HTML comments (also multi-line) but keeps them inside code blocks", () => {
    const b = parseMarkdown(
      "<!-- 생성 표시 -->\n# 제목\n\n앞 <!-- 한 줄 --> 뒤\n\n<!-- 여러\n줄 -->\n끝\n\n```\n<!-- 코드 -->\n```",
    );
    expect(b.map((x) => x.t)).toEqual(["h", "p", "p", "code"]);
    expect(b[1]).toEqual({ t: "p", text: "앞  뒤" });
    expect(b[2]).toEqual({ t: "p", text: "끝" });
    expect(b[3]).toEqual({ t: "code", text: "<!-- 코드 -->" });
  });

  it("nests inline marks and supports strikethrough, <br> and escaped pipes", () => {
    expect(parseInline("**굵게 `코드` 와 *기울임***")).toMatchObject([
      {
        t: "strong",
        children: [{ t: "text" }, { t: "code", text: "코드" }, { t: "text" }, { t: "em" }],
      },
    ]);
    expect(parseInline("~~지운 글~~")).toMatchObject([{ t: "del" }]);
    expect(parseInline("가<br>나")).toEqual([
      { t: "text", text: "가" },
      { t: "br" },
      { t: "text", text: "나" },
    ]);
    const t = parseMarkdown("| a | b |\n| --- | --- |\n| x \\| y | z |")[0];
    expect(t).toMatchObject({ t: "table", rows: [["x | y", "z"]] });
  });
});

describe("<Markdown> real-document rendering", () => {
  const wrap = (src: string, docHref?: (f: string) => string | null) =>
    render(
      <MemoryRouter>
        <Markdown blocks={parseMarkdown(src)} docHref={docHref} />
      </MemoryRouter>,
    );

  it("stacks tables of three or more columns, keeps two-column tables as tables", () => {
    const wide = wrap(
      "| 이름 | 나이 | 메모 |\n| --- | --- | --- |\n| 가 | 1 | 첫째 |\n| 나 | 2 |  |",
    );
    expect(wide.container.querySelector("table")).toBeNull();
    const rows = wide.container.querySelectorAll(".md-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("가")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("메모")).toBeInTheDocument();
    // 빈 칸은 머리글도 보이지 않는다
    expect(within(rows[1] as HTMLElement).queryByText("메모")).toBeNull();
    wide.unmount();
    const narrow = wrap("| 가 | 나 |\n| --- | --- |\n| 1 | 2 |");
    expect(screen.getByRole("table")).toBeInTheDocument();
    narrow.unmount();
  });

  it("renders details, task boxes with spoken state, nested lists and <br>", () => {
    const { container } = wrap(
      "<details>\n<summary>접힘</summary>\n\n안쪽 글\n\n</details>\n\n- [x] 끝\n- [ ] 남음\n  - 하위\n\n가  \n나",
    );
    expect(container.querySelector("details summary")?.textContent).toBe("접힘");
    expect(container.querySelector("details")?.textContent).toContain("안쪽 글");
    expect(screen.getByText("완료:")).toBeInTheDocument();
    expect(screen.getByText("아직:")).toBeInTheDocument();
    expect(container.querySelectorAll("li li")).toHaveLength(1);
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("links same-folder .md files only when the resolver knows them", () => {
    const src = "[알려진](01-가.md) 와 [모르는](99-나.md)";
    const { container } = wrap(src, (f) => (f.startsWith("01") ? "/library/doc/wiki-01" : null));
    expect(screen.getByRole("link", { name: "알려진" })).toHaveAttribute(
      "href",
      "/library/doc/wiki-01",
    );
    expect(screen.queryByRole("link", { name: "모르는" })).toBeNull();
    expect(container.textContent).toContain("모르는");
  });
});
