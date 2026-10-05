import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { configureQueue, createMemoryStore, unsentCounts } from "../lib/logs/queue";
import { SettingsPage } from "./SettingsPage";

// 로그아웃: 보내지 않은 기록이 이 기기에 있으면 건수를 알리고 「지우고 / 남겨 두고」 를 고르게 한다.

const entry = (id: string) => ({
  id,
  body: {
    type: "meal",
    occurredOn: "2020-03-11",
    recorder: "엄마",
    payload: {},
    note: null,
    deviceId: "d",
  },
  createdAt: 1,
  attempts: 0,
  status: "pending" as const,
});

let logoutCalls = 0;
beforeEach(() => {
  logoutCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string }) => {
      if (url.includes("/overview")) return Promise.resolve(new Response("{}", { status: 404 }));
      if (init?.method === "DELETE") logoutCalls += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

async function setup(ids: string[]) {
  const store = createMemoryStore();
  for (const id of ids) await store.put(entry(id));
  configureQueue({ store, online: () => false });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return store;
}

describe("logout with unsent records", () => {
  it("logs out right away when nothing is waiting", async () => {
    await setup([]);
    await userEvent.click(screen.getByRole("button", { name: "이 기기 로그아웃" }));
    await waitFor(() => {
      expect(logoutCalls).toBe(1);
    });
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("asks first, with the count; cancel keeps everything and does not log out", async () => {
    const store = await setup(["a", "b"]);
    await userEvent.click(screen.getByRole("button", { name: "이 기기 로그아웃" }));
    expect(await screen.findByText("이 기기에 보내지 않은 기록이 2건 있어요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(logoutCalls).toBe(0);
    expect(await store.getAll()).toHaveLength(2);
  });

  it("says exactly which are waiting and which failed to send", async () => {
    const store = createMemoryStore();
    await store.put(entry("a"));
    await store.put({ ...entry("b"), status: "failed" as const, createdAt: Date.now() });
    configureQueue({ store, online: () => false });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "이 기기 로그아웃" }));
    expect(await screen.findByText("이 기기에 보내지 않은 기록이 2건 있어요.")).toBeInTheDocument();
    expect(screen.getByText("1건은 남겨 두면 다시 로그인할 때 보내요.")).toBeInTheDocument();
    expect(screen.getByText(/1건은 보내지 못했어요/)).toBeInTheDocument();
  });

  it("「남겨 두고 로그아웃」 logs out and keeps the records", async () => {
    const store = await setup(["a"]);
    await userEvent.click(screen.getByRole("button", { name: "이 기기 로그아웃" }));
    await userEvent.click(await screen.findByRole("button", { name: "남겨 두고 로그아웃" }));
    await waitFor(() => {
      expect(logoutCalls).toBe(1);
    });
    expect(await store.getAll()).toHaveLength(1);
  });

  it("「지우고 로그아웃」 empties the queue, then logs out", async () => {
    const store = await setup(["a", "b", "c"]);
    await userEvent.click(screen.getByRole("button", { name: "이 기기 로그아웃" }));
    await userEvent.click(await screen.findByRole("button", { name: "지우고 로그아웃" }));
    await waitFor(() => {
      expect(logoutCalls).toBe(1);
    });
    expect(await store.getAll()).toEqual([]);
    expect(await unsentCounts()).toEqual({ pending: 0, failed: 0 });
  });
});

describe("R1-3: global lock notice", () => {
  const overviewBody = (lastGlobalLockAt: string | null, failures7d: number) => ({
    noteDays: 0,
    reports: 0,
    comments: 0,
    range: null,
    ingestState: "idle",
    security: { lastGlobalLockAt, failures7d },
    lastIngest: null,
    milestones: { observed: 0, unobserved: 0 },
    recentNotes: [],
    recentLogs: [],
  });
  const renderWith = (lock: string | null, failures7d = 3) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(overviewBody(lock, failures7d)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("shows the date of the last global lock", async () => {
    renderWith("2030-01-01T00:00:29.000Z");
    expect(await screen.findByText(/최근 전체 잠금: 2030년 1월 1일/)).toBeInTheDocument();
  });

  it("shows nothing when there was none", async () => {
    renderWith(null, 0);
    await screen.findByText("설정");
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText(/최근 전체 잠금/)).toBeNull();
    expect(screen.queryByText(/최근 7일 PIN 실패/)).toBeNull();
  });

  it("R2-1: shows failures in the last 7 days next to the lock line", async () => {
    renderWith("2030-01-01T00:00:29.000Z", 3);
    expect(await screen.findByText("최근 7일 PIN 실패: 3회")).toBeInTheDocument();
  });

  it("R2-1: shows the failure count even without a lock", async () => {
    renderWith(null, 2);
    expect(await screen.findByText("최근 7일 PIN 실패: 2회")).toBeInTheDocument();
    expect(screen.queryByText(/최근 전체 잠금/)).toBeNull();
  });
});

describe("화면 밝기 · 선명하게 보기", () => {
  it("shows a 3-option brightness group and a high-contrast switch that apply at once", async () => {
    localStorage.clear();
    delete document.documentElement.dataset.contrast;
    await setup([]);
    const group = screen.getByRole("radiogroup", { name: "화면 밝기" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "시스템에 맞춤" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "어둡게" }));
    expect(document.documentElement.dataset.scheme).toBe("dark");
    expect(localStorage.getItem("yj.scheme")).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "시스템에 맞춤" }));
    const sw = screen.getByRole("switch", { name: "선명하게 보기" });
    expect(sw).not.toBeChecked();
    expect(sw).toHaveAttribute("aria-checked", "false");
    const row = sw.closest("label") as HTMLElement;
    expect(within(row).getByText("꺼짐")).toBeInTheDocument();
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(within(row).getByText("켜짐")).toBeInTheDocument();
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(localStorage.getItem("yj.contrast")).toBe("high");
    await userEvent.click(sw);
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });
});

describe("글자·선명도", () => {
  it("groups the large-text and high-contrast switches under one heading", async () => {
    await setup([]);
    expect(screen.getByRole("heading", { level: 2, name: "글자·선명도" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "큰 글씨" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("switch", { name: "선명하게 보기" })).toBeInTheDocument();
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order.indexOf("화면 테마")).toBeLessThan(order.indexOf("화면 밝기"));
    expect(order.indexOf("화면 밝기")).toBeLessThan(order.indexOf("글자·선명도"));
  });
});
