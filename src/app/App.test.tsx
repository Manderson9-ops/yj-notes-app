import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { App } from "./App";

function mockSession(authenticated: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ authenticated }), { status: 200 }))),
  );
}

function renderApp(path = "/") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App router={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the PIN screen when not authenticated", async () => {
    mockSession(false);
    renderApp();
    expect(await screen.findByRole("button", { name: "확인" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("shows the shell with 4 tabs when authenticated", async () => {
    mockSession(true);
    renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "홈" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "설정" })).toBeInTheDocument();
  });

  it("shows the app version on the settings page", async () => {
    mockSession(true);
    renderApp("/settings");
    expect(await screen.findByText(`앱 버전 ${__APP_VERSION__}`)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "큰 글씨" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "화면 테마" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "디자인 미리보기" })).toHaveAttribute(
      "href",
      "/settings/design",
    );
  });
});
