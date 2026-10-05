import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASK_LEVELS } from "../../../shared/ask-levels";
import { LevelBadge } from "./LevelBadge";
import { RedFlagCard } from "./RedFlagCard";

describe("LevelBadge", () => {
  it.each(ASK_LEVELS)(
    "단계 $level 은 숫자와 제목이 글자로 보인다(색만으로 구분하지 않는다)",
    (l) => {
      const { container } = render(<LevelBadge level={l.level} />);
      expect(container).toHaveTextContent(`단계 ${String(l.level)}`);
      expect(container).toHaveTextContent(l.title);
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.querySelector(".ask-level")?.getAttribute("data-band")).toBe(l.band);
    },
  );

  it("compact 는 숫자만 보인다", () => {
    const { container } = render(<LevelBadge level={7} compact />);
    expect(container).toHaveTextContent("단계 7");
    expect(container).not.toHaveTextContent("어린이집");
  });
});

describe("RedFlagCard", () => {
  it("진지한 영역 안에 119 안내를 먼저 보여 준다", () => {
    render(<RedFlagCard />);
    const text = screen.getByText(/119/);
    expect(text.closest("[data-tone='serious']")).not.toBeNull();
    expect(text.closest(".notice")?.getAttribute("data-tone")).toBe("alert");
  });
});
