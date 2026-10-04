import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import HomePage from "./HomePage";

// R1-6: 적재 중·실패 배너 (자료 판정이 아니라 상태 안내).
const overview = (ingestState: "idle" | "running" | "failed") => ({
  noteDays: 0,
  reports: 0,
  comments: 0,
  range: null,
  ingestState,
  security: { lastGlobalLockAt: null },
  lastIngest: null,
  milestones: { observed: 0, unobserved: 0 },
  recentNotes: [],
  recentLogs: [],
});

function renderHome(state: "idle" | "running" | "failed") {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(overview(state)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HomePage ingest banner (R1-6)", () => {
  it("running: asks to check again later", async () => {
    renderHome("running");
    const first = await screen.findByText("자료를 갱신하는 중이에요.");
    expect(first.parentElement?.textContent).toBe(
      "자료를 갱신하는 중이에요. 잠시 뒤 다시 확인해 주세요.",
    );
  });
  it("failed: says the last update failed", async () => {
    renderHome("failed");
    expect(await screen.findByText("마지막 갱신이 실패했어요.")).toBeInTheDocument();
  });
  it("idle: no banner", async () => {
    renderHome("idle");
    await screen.findByText("아직 알림장이 없어요.");
    expect(screen.queryByText(/갱신/)).toBeNull();
  });
});
