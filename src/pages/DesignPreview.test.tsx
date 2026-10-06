import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach } from "vitest";
import { DesignPreview } from "./DesignPreview";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function renderPreview() {
  return render(
    <MemoryRouter>
      <DesignPreview />
    </MemoryRouter>,
  );
}

describe("DesignPreview", () => {
  it("shows the theme picker and all nine sample sections", () => {
    renderPreview();
    expect(screen.getByRole("heading", { level: 1, name: "디자인 미리보기" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "화면 테마" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "화면 밝기" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "선명하게 보기" })).toBeInTheDocument();
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual([
      "홈",
      "기록 입력",
      "알림장 검색",
      "자료",
      "물어보기",
      "안내 상자",
      "검진",
      "빈 상태",
      "버튼과 배지",
    ]);
  });

  it("has four notices, a serious checkup card, and highlighted matches", () => {
    const { container } = renderPreview();
    // 안내 상자 4개 + 물어보기의 위급 경고 카드 1개
    expect(container.querySelectorAll(".notice")).toHaveLength(5);
    expect(container.querySelector('.card[data-tone="serious"]')).not.toBeNull();
    expect(container.querySelectorAll("mark").length).toBeGreaterThanOrEqual(2);
  });

  it("chips are toggle buttons with exactly one pressed per group", async () => {
    const user = userEvent.setup();
    renderPreview();
    const meal = screen.getByRole("button", { name: "보통" });
    expect(meal).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "많이" }));
    expect(screen.getByRole("button", { name: "많이" })).toHaveAttribute("aria-pressed", "true");
    expect(meal).toHaveAttribute("aria-pressed", "false");
  });

  it("uses only synthetic names and marks sample values", () => {
    const { container } = renderPreview();
    const text = container.textContent;
    expect(text).toContain("테스트아이");
    expect(text).toContain("예시");
    const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d.startsWith("2020-01-")).toBe(true);
  });

  it("changes decor with the theme but keeps the same text", async () => {
    const user = userEvent.setup();
    const { container } = renderPreview();
    const empty = container.querySelector<HTMLElement>(".empty");
    if (!empty) throw new Error("empty state missing");
    expect(within(empty).queryByText("아직 기록이 없어요 (예시)")).toBeInTheDocument();
    expect(empty.querySelector("svg")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "크레용" }));
    const svgs = empty.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) {
      expect(s).toHaveAttribute("aria-hidden", "true");
      expect(s).toHaveAttribute("focusable", "false");
    }
    expect(within(empty).queryByText("아직 기록이 없어요 (예시)")).toBeInTheDocument();
  });
});
