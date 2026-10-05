import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import AskDetailPage from "./AskDetailPage";
import AskPage from "./AskPage";

// 합성 질문만. fetch 는 경로별로 대체한다.
interface Call {
  method: string;
  path: string;
  body: unknown;
}
let calls: Call[];
let routes: Record<string, (c: Call) => Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const overview = (online: boolean) => ({
  noteDays: 0,
  reports: 0,
  comments: 0,
  range: null,
  ingestState: "idle",
  security: { lastGlobalLockAt: null, failures7d: 0 },
  lastIngest: null,
  ask: { pending: 0, worker: { online, seenAt: null }, medianTotalMs7d: null },
  milestones: { observed: 0, unobserved: 0 },
  recentNotes: [],
  recentLogs: [],
});

const ANSWER = {
  level: 5,
  levelTitle: "예시",
  levelReason: "방법을 바꿔 보며 1주 적어 봐요",
  summary: "합성 요약이에요",
  fromRecords: [{ date: "2020-01-15", what: "합성 알림장", source: "알림장" }],
  evidence: [{ ref: "SYN-1", point: "합성 근거", grade: "B" }],
  tryNow: [{ action: "안아 주기", say: "많이 속상했구나" }, { action: "잠시 쉬기" }],
  avoid: ["혼내기"],
  observe: { what: "횟수", howLong: "1주", how: "적어 두기" },
  upIf: ["늘어요"],
  downIf: ["줄어요"],
  forAsker: "할머니께 한 줄",
  limits: "알림장 한계",
};

function detail(status: string, extra: Record<string, unknown> = {}) {
  return {
    question: {
      id: 7,
      askedBy: "엄마",
      body: "합성 질문 본문",
      createdAt: "2020-01-15T03:00:00.000Z",
    },
    status,
    redFlag: false,
    feedback: [],
    ...extra,
  };
}

beforeEach(() => {
  // jsdom 에는 <dialog> 모달이 없다: 열림 속성만 흉내 낸다.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, "");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      const c: Call = { method, path, body };
      calls.push(c);
      const key = `${method} ${path.split("?")[0] ?? path}`;
      const handler = routes[key];
      return Promise.resolve(handler ? handler(c) : json(404, { error: "not_found", message: "" }));
    }),
  );
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ask" element={<AskPage />} />
          <Route path="/ask/:id" element={<AskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AskPage (S50 입력·목록)", () => {
  beforeEach(() => {
    routes["GET /overview"] = () => json(200, overview(true));
    routes["GET /ask"] = () =>
      json(200, {
        items: [
          {
            id: 7,
            askedBy: "엄마",
            bodyPreview: "합성 질문 본문",
            status: "done",
            redFlag: false,
            level: 5,
            createdAt: "2020-01-15T03:00:00.000Z",
          },
          {
            id: 6,
            askedBy: "아빠",
            bodyPreview: "대기 중 질문",
            status: "pending",
            redFlag: false,
            createdAt: "2020-01-15T02:00:00.000Z",
          },
        ],
        nextBefore: null,
      });
  });

  it("목록에 상태와 단계 배지(숫자+제목)가 글자로 보인다", async () => {
    renderAt("/ask");
    expect(await screen.findByText("합성 질문 본문")).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("접수")).toBeInTheDocument();
    expect(screen.getByText("단계 5")).toBeInTheDocument();
  });

  it("기록자와 글이 없으면 보내기가 꺼져 있다", async () => {
    renderAt("/ask");
    await screen.findByText("합성 질문 본문");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("궁금한 것"), "합성 질문");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled(); // 질문하는 사람 미선택
    await userEvent.click(screen.getByRole("button", { name: "엄마" }));
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
  });

  it("위급 신호 글을 쓰면 즉시 경고 카드가 뜬다(보내기 전에)", async () => {
    renderAt("/ask");
    await screen.findByText("합성 질문 본문");
    expect(screen.queryByText(/119/)).toBeNull();
    await userEvent.type(screen.getByLabelText("궁금한 것"), "자다가 경련을 했어요");
    const warn = screen.getByText(/119/);
    expect(warn.closest("[data-tone='serious']")).not.toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("보내면 질문 번호 화면으로 이동하고 기록자를 기억한다", async () => {
    routes["POST /ask"] = () =>
      json(201, { id: 7, status: "pending", redFlag: false, instant: { notes: [], docs: [] } });
    routes["GET /ask/7"] = () => json(200, detail("pending"));
    routes["GET /ask/7/instant"] = () => json(200, { notes: [], docs: [] });
    renderAt("/ask");
    await screen.findByText("합성 질문 본문");
    await userEvent.click(screen.getByRole("button", { name: "할머니" }));
    await userEvent.type(screen.getByLabelText("궁금한 것"), "  합성 질문  ");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "질문" })).toBeInTheDocument();
    });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ body: "합성 질문", askedBy: "할머니" });
    expect(localStorage.getItem("yj.recorder")).toBe("할머니");
  });

  it("너무 많이 보냈으면(429) 안내하고 글을 지우지 않는다", async () => {
    routes["POST /ask"] = () => json(429, { error: "too_many", message: "x" });
    renderAt("/ask");
    await screen.findByText("합성 질문 본문");
    await userEvent.click(screen.getByRole("button", { name: "엄마" }));
    await userEvent.type(screen.getByLabelText("궁금한 것"), "합성 질문");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText(/너무 많이 보냈어요/)).toBeInTheDocument();
    expect(screen.getByLabelText("궁금한 것")).toHaveValue("합성 질문");
  });

  it("집 PC 가 꺼져 있으면 안내한다", async () => {
    routes["GET /overview"] = () => json(200, overview(false));
    renderAt("/ask");
    expect(await screen.findByText("집 PC가 꺼져 있어요.")).toBeInTheDocument();
  });
});

describe("AskDetailPage (진행·답변·의견)", () => {
  beforeEach(() => {
    routes["GET /overview"] = () => json(200, overview(true));
    routes["GET /ask/7/instant"] = () =>
      json(200, {
        notes: [{ id: 1, date: "2020-01-14", snippet: "합성 알림장 발췌" }],
        docs: [{ slug: "guide-01", title: "합성 자료 제목" }],
      });
  });

  it("대기 중: 진행 단계와 aria-live 상태 줄, 즉시 결과", async () => {
    routes["GET /ask/7"] = () => json(200, detail("pending"));
    renderAt("/ask/7");
    expect(await screen.findByText("합성 질문 본문")).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "진행 단계" });
    expect(steps.querySelector("[aria-current='step']")?.textContent).toContain("접수");
    expect(screen.getByRole("status")).toHaveTextContent("질문을 받았어요");
    expect(await screen.findByText("합성 알림장 발췌")).toBeInTheDocument();
    expect(screen.getByText("합성 자료 제목")).toBeInTheDocument();
    expect(screen.queryByText("답변")).toBeNull();
  });

  it("집 PC 가 꺼져 있고 대기 중이면 「집 PC가 켜지면 답변해요」", async () => {
    routes["GET /overview"] = () => json(200, overview(false));
    routes["GET /ask/7"] = () => json(200, detail("pending"));
    renderAt("/ask/7");
    expect(await screen.findByText("집 PC가 켜지면 답변해요.")).toBeInTheDocument();
  });

  it("작성 중·검토 중 상태가 현재 단계로 표시된다", async () => {
    routes["GET /ask/7"] = () => json(200, detail("reviewing"));
    renderAt("/ask/7");
    await screen.findByText("합성 질문 본문");
    const now = screen
      .getByRole("list", { name: "진행 단계" })
      .querySelector("[aria-current='step']");
    expect(now?.textContent).toContain("검토 중");
  });

  it("완료: 답변 카드의 모든 구역이 순서대로 보이고 폴링이 멈춘다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail("done", { answer: { level: 5, answer: ANSWER, createdAt: "x", totalMs: 90000 } }),
      );
    renderAt("/ask/7");
    const card = await screen.findByRole("article", { name: "답변" });
    const headings = [...card.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual([
      "상황 요약",
      "기록에서 본 것",
      "근거",
      "지금 해 볼 것",
      "피할 것",
      "관찰 방법",
      "단계가 올라가는 신호",
      "단계가 내려가는 신호",
      "질문하신 분께",
      "한계",
    ]);
    expect(card).toHaveTextContent("단계 5");
    expect(card.querySelector(".ask-say")).toHaveTextContent("많이 속상했구나");
    expect(screen.queryByRole("list", { name: "진행 단계" })).toBeNull();
    const before = calls.filter((c) => c.path === "/ask/7").length;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.path === "/ask/7").length).toBe(before);
  });

  it("위급 질문은 경고 카드를 먼저 보여 준다", async () => {
    routes["GET /ask/7"] = () => json(200, { ...detail("pending"), redFlag: true });
    renderAt("/ask/7");
    const warn = await screen.findByText(/119/);
    expect(warn.closest("[data-tone='serious']")).not.toBeNull();
  });

  it("실패: 안내와 새로 질문하기", async () => {
    routes["GET /ask/7"] = () => json(200, detail("failed"));
    renderAt("/ask/7");
    expect(
      await screen.findByText("답을 만들지 못했어요.", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새로 질문하기" })).toBeInTheDocument();
  });

  it("의견: 도움이 됐어요 / 메모를 보낸다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail("done", { answer: { level: 5, answer: ANSWER, createdAt: "x", totalMs: 1 } }),
      );
    routes["POST /ask/7/feedback"] = () => json(201, { id: 1 });
    localStorage.setItem("yj.recorder", "아빠");
    renderAt("/ask/7");
    await userEvent.click(await screen.findByRole("button", { name: "도움이 됐어요" }));
    await userEvent.type(screen.getByLabelText("해 봤어요 메모"), "안아 주니 그쳤어요");
    await userEvent.click(screen.getByRole("button", { name: "메모 남기기" }));
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.body);
    expect(posts).toEqual([
      { by: "아빠", helpful: true },
      { by: "아빠", note: "안아 주니 그쳤어요" },
    ]);
  });

  it("지우기는 확인을 거친다", async () => {
    routes["GET /ask/7"] = () => json(200, detail("pending"));
    routes["DELETE /ask/7"] = () => new Response(null, { status: 204 });
    routes["GET /ask"] = () => json(200, { items: [], nextBefore: null });
    renderAt("/ask/7");
    await userEvent.click(await screen.findByRole("button", { name: "질문 지우기" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(await screen.findByRole("button", { name: "지우기" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "물어보기" })).toBeInTheDocument();
  });

  it("없는 질문 번호는 안내한다", async () => {
    renderAt("/ask/abc");
    expect(await screen.findByText("찾는 질문이 없어요.")).toBeInTheDocument();
  });
});

describe("상세 폴링(5초)", () => {
  const detailCalls = () => calls.filter((c) => c.method === "GET" && c.path === "/ask/7").length;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes["GET /overview"] = () => json(200, overview(true));
    routes["GET /ask/7/instant"] = () => json(200, { notes: [], docs: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("5초마다 다시 보고, 완료되면 멈춘다", async () => {
    let n = 0;
    routes["GET /ask/7"] = () => {
      n += 1;
      return json(
        200,
        n < 3
          ? detail(n === 1 ? "pending" : "answering")
          : detail("done", { answer: { level: 5, answer: ANSWER, createdAt: "x", totalMs: 1 } }),
      );
    };
    renderAt("/ask/7");
    await screen.findByText("합성 질문 본문");
    expect(detailCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(5100);
    expect(detailCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(5100);
    expect(await screen.findByRole("article", { name: "답변" })).toBeInTheDocument();
    expect(detailCalls()).toBe(3);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(detailCalls()).toBe(3);
  });

  it("탭이 숨겨지면 멈추고, 다시 보이면 이어 간다", async () => {
    routes["GET /ask/7"] = () => json(200, detail("pending"));
    renderAt("/ask/7");
    await screen.findByText("합성 질문 본문");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const before = detailCalls();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(detailCalls()).toBe(before);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5100);
    expect(detailCalls()).toBeGreaterThan(before);
  });
});
