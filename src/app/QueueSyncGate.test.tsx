import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueueSyncGate } from "./QueueSyncGate";

const Ok = () => <p>동기화 켜짐</p>;

describe("QueueSyncGate", () => {
  it("로드에 실패하면 앱은 멈추지 않고, online 이 오면 새로 내려받아 켠다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Ok });
    render(<QueueSyncGate load={load} />);
    await act(() => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("동기화 켜짐")).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(await screen.findByText("동기화 켜짐")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("화면이 다시 보일 때(visibilitychange)도 다시 시도한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: Ok });
    render(<QueueSyncGate load={load} />);
    await act(() => Promise.resolve());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(await screen.findByText("동기화 켜짐")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("성공하면 다시 내려받지 않는다", async () => {
    const load = vi.fn().mockResolvedValue({ default: Ok });
    render(<QueueSyncGate load={load} />);
    expect(await screen.findByText("동기화 켜짐")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
