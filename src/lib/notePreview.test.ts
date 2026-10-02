import { describe, expect, it } from "vitest";
import { previewOfBody, previewOfDay } from "./notePreview";

describe("previewOfBody", () => {
  it("uses the first line and squeezes repeated spaces", () => {
    expect(previewOfBody("블록을  쌓고   놀았어요.\n둘째 줄")).toBe("블록을 쌓고 놀았어요.");
  });
  it("skips a short one-line greeting question when more text follows", () => {
    expect(previewOfBody("테스트아이와 즐거운 주말 보내셨나요?\n\n모래놀이를 했어요.")).toBe(
      "모래놀이를 했어요.",
    );
    expect(previewOfBody("안녕하세요.\n오늘은 그림을 그렸어요.")).toBe("오늘은 그림을 그렸어요.");
  });
  it("keeps a greeting that is the only line", () => {
    expect(previewOfBody("주말 잘 보내셨나요?")).toBe("주말 잘 보내셨나요?");
  });
  it("does not skip a question inside a longer paragraph or a long question", () => {
    expect(previewOfBody("오늘 뭐 했게요?\n블록을 쌓았어요.")).toBe("오늘 뭐 했게요?");
    const long = `${"가".repeat(60)}?`;
    expect(previewOfBody(`${long}\n\n뒷글`)).toBe(`${"가".repeat(60)}?`.slice(0, 90));
  });
  it("skips at most two greeting lines", () => {
    expect(previewOfBody("잘 지내셨나요?\n\n날씨가 좋았나요?\n\n좋은 하루예요?\n\n끝")).toBe(
      "좋은 하루예요?",
    );
  });
  it("cuts long lines at a word boundary with an ellipsis", () => {
    const text = Array.from({ length: 40 }, () => "단어").join(" ");
    const out = previewOfBody(text);
    expect(out.endsWith("…")).toBe(true);
    expect([...out].length).toBeLessThanOrEqual(91);
    expect(out.endsWith(" …")).toBe(false);
  });
  it("returns empty for blank text", () => {
    expect(previewOfBody("  \n\n ")).toBe("");
  });
});

describe("previewOfDay", () => {
  it("prefers notes sent home over notes from home, then the longest body", () => {
    expect(
      previewOfDay([
        { direction: "to_center", body: "집에서 보낸 아주 아주 긴 메모를 적었어요 정말로 길게" },
        { direction: "to_home", body: "준비물 안내." },
        { direction: "to_home", body: "오늘은 블록을 쌓고 놀았어요." },
      ]),
    ).toBe("오늘은 블록을 쌓고 놀았어요.");
  });
  it("falls back to the stored first line when there is no body", () => {
    expect(previewOfDay([], "저장된 첫 줄")).toBe("저장된 첫 줄");
    expect(previewOfDay([{ direction: "to_home", body: "" }])).toBe("");
  });
});
