import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
    vi.fn((_url: string, init?: { method?: string }) => {
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
    await store.put({ ...entry("b"), status: "failed" as const });
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
