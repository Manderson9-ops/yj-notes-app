import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

describe("App", () => {
  it("renders heading, app title and version footer", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App router={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "기록" })).toBeInTheDocument();
    expect(screen.getByText("가족 기록")).toBeInTheDocument();
    expect(screen.getByText(`버전 ${__APP_VERSION__}`)).toBeInTheDocument();
  });
});
