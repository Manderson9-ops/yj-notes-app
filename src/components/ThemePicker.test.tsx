import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach } from "vitest";
import { THEME_KEY } from "../lib/theme";
import { ThemePicker } from "./ThemePicker";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("ThemePicker", () => {
  it("is a radiogroup with the three themes, basic selected", () => {
    render(<ThemePicker />);
    expect(screen.getByRole("radiogroup", { name: "화면 테마" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([
      "basic",
      "crayon",
      "forest",
    ]);
    expect(screen.getByRole("radio", { name: "기본" })).toBeChecked();
  });

  it("applies and saves the chosen theme immediately", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    await user.click(screen.getByRole("radio", { name: "숲" }));
    expect(screen.getByRole("radio", { name: "숲" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(localStorage.getItem(THEME_KEY)).toBe("forest");
    await user.click(screen.getByRole("radio", { name: "기본" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
