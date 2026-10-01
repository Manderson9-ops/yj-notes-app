import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { PinScreen } from "./PinScreen";

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPin() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <PinScreen />
    </QueryClientProvider>,
  );
}

function lastBody(): unknown {
  const init = fetchMock.mock.calls.at(-1)?.[1];
  return JSON.parse(init?.body as string);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PinScreen", () => {
  it("shows title, keypad and no digits", async () => {
    const user = userEvent.setup();
    renderPin();
    expect(screen.getByRole("heading", { name: "가족 기록" })).toBeInTheDocument();
    for (const k of "0123456789") {
      expect(screen.getByRole("button", { name: k })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText("2자리 입력됨")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "지우기" }));
    expect(screen.getByText("1자리 입력됨")).toBeInTheDocument();
  });

  it("limits to 12 digits and needs 4 to confirm", async () => {
    const user = userEvent.setup();
    renderPin();
    const confirm = screen.getByRole("button", { name: "확인" });
    expect(confirm).toBeDisabled();
    await user.keyboard("123");
    expect(confirm).toBeDisabled();
    await user.keyboard("4567890123456");
    expect(screen.getByText("12자리 입력됨")).toBeInTheDocument();
    expect(confirm).toBeEnabled();
  });

  it("submits typed PIN with the physical keyboard (Enter)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderPin();
    await user.keyboard("0000{Enter}");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(lastBody()).toEqual({ pin: "0000" });
  });

  it("Backspace removes a digit", async () => {
    const user = userEvent.setup();
    renderPin();
    await user.keyboard("123{Backspace}");
    expect(screen.getByText("2자리 입력됨")).toBeInTheDocument();
  });

  it("shows the wrong-PIN message and clears the input", async () => {
    fetchMock.mockResolvedValue(json(401, { error: "invalid_pin", message: "x" }));
    const user = userEvent.setup();
    renderPin();
    await user.keyboard("9999");
    await user.click(screen.getByRole("button", { name: "확인" }));
    expect(await screen.findByText("PIN 이 맞지 않아요.")).toBeInTheDocument();
    expect(screen.getByText("0자리 입력됨")).toBeInTheDocument();
  });

  it("shows a network error message", async () => {
    fetchMock.mockRejectedValue(new TypeError("fail"));
    const user = userEvent.setup();
    renderPin();
    await user.keyboard("9999{Enter}");
    expect(await screen.findByText(/연결이 안 돼요/)).toBeInTheDocument();
  });

  it("locks with a countdown from retryAfterSec", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(json(429, { error: "locked", message: "x", retryAfterSec: 125 }));
    renderPin();
    for (const k of "1111") fireEvent.click(screen.getByRole("button", { name: k }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(await screen.findByText("잠시 잠겼어요. 3분 뒤에 다시 해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText("잠시 잠겼어요. 1분 뒤에 다시 해 주세요.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText(/잠시 잠겼어요/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1" })).toBeEnabled();
  });
});
