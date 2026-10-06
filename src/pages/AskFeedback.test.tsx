// 물어보기 2차(T-Q3) 화면 시험: 표(aria-pressed 토글), 다시 답변 이유 흐름, 공유(navigator.share / 클립보드), 설정 한 줄.
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import AskDetailPage from "./AskDetailPage";
import { SettingsPage } from "./SettingsPage";

interface Call {
  method: string;
  path: string;
  body: unknown;
}
let calls: Call[];
let routes: Record<string, (c: Call) => Response>;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ANSWER = {
  kind: "behavior",
  level: 5,
  levelTitle: "예시",
  levelReason: "방법을 바꿔 보며 1주 적어 봐요",
  summary: "합성 요약이에요",
  fromRecords: [],
  evidence: [{ ref: "SYN-1", point: "합성 근거", grade: "B" }],
  tryNow: [{ action: "안아 주기", say: "많이 속상했구나", basis: "SYN-1" }],
  avoid: ["혼내기"],
  observe: { what: "횟수", howLong: "1주", how: "적어 두기" },
  upIf: ["소아과에 물어봐요"],
  downIf: ["줄어요"],
  forAsker: "할머니께 한 줄",
};

interface Vote {
  by: string;
  helpful: boolean;
  reason: string | null;
  updatedAt: string;
}
function detail(over: Record<string, unknown> = {}) {
  return {
    question: {
      id: 7,
      askedBy: "엄마",
      body: "합성 질문 본문",
      createdAt: "2020-01-15T03:00:00.000Z",
    },
    status: "done",
    redFlag: false,
    answer: { level: 5, answer: ANSWER, createdAt: "2020-01-15T03:10:00.000Z", totalMs: 1 },
    feedback: [],
    votes: [] as Vote[],
    history: [],
    reask: { count: 0, reason: null, by: null },
    ...over,
  };
}
const vote = (by: string, helpful: boolean, reason: string | null = null): Vote => ({
  by,
  helpful,
  reason,
  updatedAt: "2020-01-15T04:00:00.000Z",
});

beforeEach(() => {
  calls = [];
  routes = {};
  localStorage.clear();
  localStorage.setItem("yj.recorder", "아빠");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, "");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      const c: Call = { method, path, body };
      calls.push(c);
      const handler = routes[`${method} ${path.split("?")[0] ?? path}`];
      return Promise.resolve(handler ? handler(c) : json(404, { error: "not_found", message: "" }));
    }),
  );
  routes["GET /overview"] = () => json(404, {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderAt() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/ask/7"]}>
        <Routes>
          <Route path="/ask/:id" element={<AskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const puts = () => calls.filter((c) => c.method === "PUT").map((c) => c.body);

describe("표 (aria-pressed 토글)", () => {
  it("처음엔 둘 다 눌리지 않음 → 누르면 저장 + 안내(aria-live) → 같은 걸 다시 누르면 취소", async () => {
    let votes: Vote[] = [];
    routes["GET /ask/7"] = () => json(200, detail({ votes }));
    routes["PUT /ask/7/vote"] = (c) => {
      const b = c.body as { by: string; helpful: boolean | null; reason?: string };
      votes = b.helpful === null ? [] : [vote(b.by, b.helpful, b.reason ?? null)];
      return json(200, { votes });
    };
    renderAt();
    const up = await screen.findByRole("button", { name: /도움이 됐어요/ });
    const down = screen.getByRole("button", { name: /도움이 안 됐어요/ });
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(up);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /도움이 됐어요/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(puts()).toEqual([{ by: "아빠", helpful: true }]);
    const live = screen.getByTestId("ask-vote-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("반영했어요. 다음 답변에 참고해요.");

    await userEvent.click(screen.getByRole("button", { name: /도움이 됐어요/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /도움이 됐어요/ })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(puts().at(-1)).toEqual({ by: "아빠", helpful: null });
    expect(screen.getByTestId("ask-vote-live")).toHaveTextContent("표를 취소했어요");
  });

  it("다른 쪽을 누르면 바꾸기(같은 사람의 표는 한 줄)", async () => {
    let votes: Vote[] = [vote("아빠", true)];
    routes["GET /ask/7"] = () => json(200, detail({ votes }));
    routes["PUT /ask/7/vote"] = (c) => {
      const b = c.body as { by: string; helpful: boolean };
      votes = [vote(b.by, b.helpful)];
      return json(200, { votes });
    };
    renderAt();
    expect(await screen.findByRole("button", { name: /도움이 됐어요/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: /도움이 안 됐어요/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /도움이 안 됐어요/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: /도움이 됐어요/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(puts()).toEqual([{ by: "아빠", helpful: false }]);
  });

  it("가족별 표 요약(엄마 👍 · 할머니 👎)이 글로도 읽힌다", async () => {
    routes["GET /ask/7"] = () =>
      json(200, detail({ votes: [vote("엄마", true), vote("할머니", false, "이유")] }));
    renderAt();
    const sum = await screen.findByTestId("ask-vote-summary");
    expect(sum).toHaveTextContent("엄마 👍");
    expect(sum).toHaveTextContent("할머니 👎");
    expect(sum).toHaveTextContent("도움이 안 됐어요");
  });

  it("메모 칸 안내 문구", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    renderAt();
    expect(
      await screen.findByText("해 본 방법과 결과를 적으면 다음 답변에 반영돼요"),
    ).toBeInTheDocument();
  });
});

describe("다시 답변 (👎 → 이유 → 다시 답변 받기)", () => {
  it("👎 를 누르면 이유 선택 패널, 이유 없이는 버튼이 막혀 있다", async () => {
    let votes: Vote[] = [];
    routes["GET /ask/7"] = () => json(200, detail({ votes }));
    routes["PUT /ask/7/vote"] = (c) => {
      const b = c.body as { by: string; helpful: boolean; reason?: string };
      votes = [vote(b.by, b.helpful, b.reason ?? null)];
      return json(200, { votes });
    };
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: /도움이 안 됐어요/ }));
    const panel = await screen.findByTestId("ask-reask-panel");
    expect(panel).toHaveTextContent("어떤 점이 아쉬웠나요?");
    for (const c of [
      "너무 일반적이에요",
      "이미 해 봤어요",
      "우리 상황과 달라요",
      "더 자세히 알고 싶어요",
    ]) {
      expect(screen.getByRole("button", { name: c })).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).toBeDisabled();
  });

  it("이유 선택 + 자유 글 → 표(이유)를 남기고 reask 를 보낸다", async () => {
    let votes: Vote[] = [vote("아빠", false)];
    routes["GET /ask/7"] = () => json(200, detail({ votes }));
    routes["PUT /ask/7/vote"] = (c) => {
      const b = c.body as { by: string; helpful: boolean; reason?: string };
      votes = [vote(b.by, b.helpful, b.reason ?? null)];
      return json(200, { votes });
    };
    routes["POST /ask/7/reask"] = () => json(200, { status: "pending", reaskCount: 1 });
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: "이미 해 봤어요" }));
    await userEvent.type(screen.getByLabelText("더 알려 주고 싶은 점(선택)"), "간식도 줄여 봤어요");
    await userEvent.click(screen.getByRole("button", { name: "다시 답변 받기" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === "/ask/7/reask")).toBe(true);
    });
    expect(puts().at(-1)).toEqual({
      by: "아빠",
      helpful: false,
      reason: "이미 해 봤어요 · 간식도 줄여 봤어요",
    });
    expect(calls.find((c) => c.path === "/ask/7/reask")?.body).toEqual({
      by: "아빠",
      choice: "이미 해 봤어요",
      text: "간식도 줄여 봤어요",
    });
  });

  it("다시 답변을 모두 받았으면(3회) 버튼이 막히고 안내한다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({ votes: [vote("아빠", false)], reask: { count: 3, reason: "x", by: "엄마" } }),
      );
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: "더 자세히 알고 싶어요" }));
    expect(screen.getByText("이 질문은 다시 답변을 모두 받았어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).toBeDisabled();
  });

  it("이유만 남기기는 reask 없이 표의 이유만 저장한다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ votes: [vote("아빠", false)] }));
    routes["PUT /ask/7/vote"] = () => json(200, { votes: [] });
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: "너무 일반적이에요" }));
    await userEvent.click(screen.getByRole("button", { name: "이유만 남기기" }));
    await waitFor(() => {
      expect(puts()).toEqual([{ by: "아빠", helpful: false, reason: "너무 일반적이에요" }]);
    });
    expect(calls.some((c) => c.path === "/ask/7/reask")).toBe(false);
  });

  it("다시 작성 중: 「다시 작성 중」 표시와 이전 답변 접어 보기, 표·공유는 숨김", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          status: "answering",
          answer: undefined,
          reask: { count: 1, reason: "이미 해 봤어요", by: "아빠" },
          history: [
            { version: 1, level: 5, createdAt: "2020-01-15T03:10:00.000Z", answer: ANSWER },
          ],
        }),
      );
    renderAt();
    expect(
      await screen.findByText("다시 작성 중이에요. 조금만 기다려 주세요."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("다시 작성 중").length).toBeGreaterThan(0);
    expect(screen.getByText(/이전 답변 1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "공유하기" })).toBeNull();
    expect(screen.queryByText("이 답이 도움이 됐나요?")).toBeNull();
  });

  it("다시 답변이 끝나면 이전 표는 지금 답에 대한 표로 세지 않는다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          votes: [vote("아빠", false)], // 04:00 — 새 답(05:00)보다 이전
          answer: { level: 5, answer: ANSWER, createdAt: "2020-01-16T05:00:00.000Z", totalMs: 1 },
          history: [
            { version: 1, level: 5, createdAt: "2020-01-15T03:10:00.000Z", answer: ANSWER },
          ],
          reask: { count: 1, reason: "x", by: "아빠" },
        }),
      );
    renderAt();
    expect(await screen.findByRole("button", { name: /도움이 안 됐어요/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByTestId("ask-reask-panel")).toBeNull();
  });
});

describe("공유하기 · 복사하기", () => {
  beforeEach(() => {
    routes["GET /ask/7"] = () => json(200, detail());
  });

  it("답 맨 위(요약 아래)와 맨 아래에 두 번 있다 + 앱 밖 안내", async () => {
    renderAt();
    await screen.findByTestId("ask-share-top");
    expect(screen.getByTestId("ask-share-bottom")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "공유하기" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "복사하기" })).toHaveLength(2);
    expect(screen.getAllByText("공유한 글은 앱 밖으로 나가요.").length).toBeGreaterThan(0);
    const summaryHeading = screen.getByRole("heading", { name: "상황 요약" });
    const top = screen.getByTestId("ask-share-top");
    expect(
      summaryHeading.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("navigator.share 가 있으면 title·text·url 로 부른다(요약형)", async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      renderAt();
      await userEvent.click((await screen.findAllByRole("button", { name: "공유하기" }))[0]!);
      expect(share).toHaveBeenCalledTimes(1);
      const arg = (
        share.mock.calls as unknown as [{ title: string; text: string; url: string }][]
      )[0]?.[0];
      expect(arg?.title).toBe("물어보기 2020-01-15");
      expect(arg?.url).toBe(`${window.location.origin}/ask/7`);
      expect(arg?.text).toContain("📝 아이 물어보기 (2020-01-15 · 질문: 엄마)");
      expect(arg?.text).toContain("1. 안아 주기\n   👉 「많이 속상했구나」");
      expect(arg?.text).not.toContain("상황 요약"); // 요약형
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("전체를 고르면 기록·근거·한계가 더해진다", async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      renderAt();
      const full = (await screen.findAllByRole("button", { name: "전체" }))[0]!;
      await userEvent.click(full);
      expect((await screen.findAllByRole("button", { name: "전체" }))[1]).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await userEvent.click(screen.getAllByRole("button", { name: "공유하기" })[1]!);
      const arg = (share.mock.calls as unknown as [{ text: string }][])[0]?.[0];
      expect(arg?.text).toContain("📌 상황 요약");
      expect(arg?.text).toContain("🔎 근거");
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("share 가 없으면 클립보드에 복사하고 「복사했어요」", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt();
    await userEvent.click((await screen.findAllByRole("button", { name: "공유하기" }))[0]!);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("복사했어요.")).toBeInTheDocument();
  });

  it("복사하기 버튼은 share 가 있어도 복사한다", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt();
    await userEvent.click((await screen.findAllByRole("button", { name: "복사하기" }))[1]!);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("공유 취소(AbortError)·복사 실패는 조용히 넘어간다", async () => {
    const share = vi.fn(() => Promise.reject(new DOMException("x", "AbortError")));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      renderAt();
      await userEvent.click((await screen.findAllByRole("button", { name: "공유하기" }))[0]!);
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    await userEvent.click(screen.getAllByRole("button", { name: "복사하기" })[0]!);
    expect(screen.queryByText("복사했어요.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("설정: 최근 7일 의견 한 줄", () => {
  const ov = (fb?: unknown) => ({
    noteDays: 0,
    reports: 0,
    comments: 0,
    range: null,
    ingestState: "idle",
    security: { lastGlobalLockAt: null, failures7d: 0 },
    lastIngest: null,
    ask: {
      pending: 0,
      worker: { online: true, seenAt: null },
      medianTotalMs7d: null,
      ...(fb ? { feedback7d: fb } : {}),
    },
    milestones: { observed: 0, unobserved: 0 },
    recentNotes: [],
    recentLogs: [],
  });
  const renderSettings = () =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("API 숫자를 그대로 보인다", async () => {
    routes["GET /overview"] = () => json(200, ov({ up: 3, down: 1, notes: 2 }));
    renderSettings();
    const line = await screen.findByTestId("ask-feedback-7d");
    expect(line).toHaveTextContent(
      "최근 7일 의견: 👍도움이 됐어요 3 · 👎도움이 안 됐어요 1 · 메모 2",
    );
  });

  it("값이 없으면 줄을 만들지 않는다", async () => {
    routes["GET /overview"] = () => json(200, ov());
    renderSettings();
    await screen.findByRole("heading", { name: "설정" });
    await waitFor(() => {
      expect(calls.some((c) => c.path === "/overview")).toBe(true);
    });
    expect(screen.queryByTestId("ask-feedback-7d")).toBeNull();
  });
});
