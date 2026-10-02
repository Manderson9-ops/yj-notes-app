import { describe, expect, it } from "vitest";
import { findHeadingId } from "./anchor";
import { parseMarkdown } from "./mdParse";

const blocks = parseMarkdown(
  ["# 제목", "## 3. 상황", "### 3-1. 하나", "### 3-10. 열", "### 3.2 둘", "## 4 넷"].join("\n\n"),
);
const idOf = (text: string) => {
  const b = blocks.find((x) => x.t === "h" && x.text === text);
  return b?.t === "h" ? b.id : null;
};

describe("findHeadingId", () => {
  it("matches a section number at the start of a heading", () => {
    expect(findHeadingId(blocks, "#3-1")).toBe(idOf("3-1. 하나"));
    expect(findHeadingId(blocks, "4")).toBe(idOf("4 넷"));
  });
  it("does not confuse 3-1 with 3-10, and accepts 3.2 as 3-2", () => {
    expect(findHeadingId(blocks, "#3-10")).toBe(idOf("3-10. 열"));
    expect(findHeadingId(blocks, "#3-2")).toBe(idOf("3.2 둘"));
  });
  it("matches a heading id directly", () => {
    const id = idOf("4 넷");
    expect(findHeadingId(blocks, `#${id ?? ""}`)).toBe(id);
  });
  it("returns null when absent or malformed", () => {
    expect(findHeadingId(blocks, "#9-9")).toBeNull();
    expect(findHeadingId(blocks, "")).toBeNull();
    expect(findHeadingId(blocks, "#%E0%A4%A")).toBeNull();
    expect(findHeadingId(blocks, "#abc")).toBeNull();
  });
});
