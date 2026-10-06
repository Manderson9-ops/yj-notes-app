// 물어보기 2차(T-Q3) 화면 시험: 표(aria-pressed 토글), 이유 라디오 그룹, 다시 답변 흐름(포커스·알림), 공유(navigator.share / 클립보드),
// 설정 한 줄. 합성 자료만.
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const NOT_BEHAVIOR = {
  kind: "not_behavior",
  level: 1,
  levelTitle: "",
  levelReason: "아이 행동 걱정을 묻는 곳이에요",
  summary: "행동 질문이 아니에요",
  fromRecords: [],
  evidence: [],
  tryNow: [],
  avoid: [],
  upIf: [],
  downIf: [],
  forAsker: "엄마께: 행동을 물어봐 주세요",
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
const upBtn = () => screen.getByRole("button", { name: /도움이 됐어요/ });
const downBtn = () => screen.getByRole("button", { name: /도움이 안 됐어요/ });
const radio = (name: string) => screen.getByRole("radio", { name });

/** 표를 서버처럼 저장하는 경로(PUT /vote). */
function voteRoutes(initial: Vote[] = []) {
  let votes = initial;
  routes["GET /ask/7"] = () => json(200, detail({ votes }));
  routes["PUT /ask/7/vote"] = (c) => {
    const b = c.body as { by: string; helpful: boolean | null; reason?: string };
    votes = b.helpful === null ? [] : [vote(b.by, b.helpful, b.reason ?? null)];
    return json(200, { votes });
  };
}

describe("표 (aria-pressed 토글)", () => {
  it("누르면 저장 + 안내(aria-live) → 같은 걸 다시 누르면 취소", async () => {
    voteRoutes();
    renderAt();
    await screen.findByRole("button", { name: /도움이 됐어요/ });
    expect(upBtn()).toHaveAttribute("aria-pressed", "false");
    expect(downBtn()).toHaveAttribute("aria-pressed", "false");
    // 비어 있는 안내 칸은 자리를 차지하지 않는다(숨김)
    expect(screen.getByTestId("ask-vote-live")).toBeEmptyDOMElement();

    await userEvent.click(upBtn());
    await waitFor(() => {
      expect(upBtn()).toHaveAttribute("aria-pressed", "true");
    });
    expect(puts()).toEqual([{ by: "아빠", helpful: true }]);
    const live = screen.getByTestId("ask-vote-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("반영했어요. 다음 답변에 참고해요.");

    await userEvent.click(upBtn());
    await waitFor(() => {
      expect(upBtn()).toHaveAttribute("aria-pressed", "false");
    });
    expect(puts().at(-1)).toEqual({ by: "아빠", helpful: null });
    expect(screen.getByTestId("ask-vote-live")).toHaveTextContent("표를 취소했어요");
  });

  it("👎 는 「표를 남겼어요. 아쉬운 점을 골라 주세요.」, 이유 없이 👍 와는 다른 안내", async () => {
    voteRoutes();
    renderAt();
    await screen.findByRole("button", { name: /도움이 안 됐어요/ });
    await userEvent.click(downBtn());
    expect(await screen.findByText("표를 남겼어요. 아쉬운 점을 골라 주세요.")).toBeInTheDocument();
    expect(screen.queryByText(/반영했어요/)).toBeNull();
  });

  it("다른 쪽을 누르면 바꾸기(같은 사람의 표는 한 줄)", async () => {
    voteRoutes([vote("아빠", true)]);
    renderAt();
    await screen.findByRole("button", { name: /도움이 됐어요/ });
    expect(upBtn()).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(downBtn());
    await waitFor(() => {
      expect(downBtn()).toHaveAttribute("aria-pressed", "true");
    });
    expect(upBtn()).toHaveAttribute("aria-pressed", "false");
    expect(puts()).toEqual([{ by: "아빠", helpful: false }]);
  });

  it("「가족 의견: 엄마 👍 · 할머니 👎」 + 내 표 표시, 글로도 읽힌다", async () => {
    routes["GET /ask/7"] = () =>
      json(200, detail({ votes: [vote("엄마", true), vote("아빠", false, "이유")] }));
    renderAt();
    const sum = await screen.findByTestId("ask-vote-summary");
    expect(sum).toHaveTextContent("가족 의견: 엄마 👍");
    expect(sum).toHaveTextContent("아빠 👎");
    expect(sum).toHaveTextContent("(내 표)");
    expect(sum).toHaveTextContent("도움이 안 됐어요");
    // 내 표만 표시
    expect(within(sum).getAllByText(/내 표/)).toHaveLength(1);
  });

  it("메모 칸 안내 문구", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    renderAt();
    expect(
      await screen.findByText("해 본 방법과 결과를 적으면 다음 답변에 반영돼요"),
    ).toBeInTheDocument();
  });
});

describe("이유 고르기 (라디오 그룹)", () => {
  it("👎 를 누르면 패널: 라디오 4개(aria-checked), 고르기 전엔 버튼이 막히고 안내가 붙는다", async () => {
    voteRoutes();
    renderAt();
    await screen.findByRole("button", { name: /도움이 안 됐어요/ });
    await userEvent.click(downBtn());
    const panel = await screen.findByTestId("ask-reask-panel");
    expect(panel).toHaveTextContent("어떤 점이 아쉬웠나요?");
    const group = screen.getByRole("radiogroup", { name: "어떤 점이 아쉬웠나요?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    for (const r of radios) expect(r).toHaveAttribute("aria-checked", "false");
    const go = screen.getByRole("button", { name: "다시 답변 받기" });
    const keep = screen.getByRole("button", { name: "다시 답변 없이 이유만 저장" });
    expect(go).toBeDisabled();
    expect(keep).toBeDisabled();
    const help = screen.getByText("아쉬운 점을 하나 골라 주세요.");
    expect(go).toHaveAttribute("aria-describedby", help.id);
    expect(keep).toHaveAttribute("aria-describedby", help.id);
    // 고르면 안내가 사라지고 버튼이 켜진다
    await userEvent.click(radio("이미 해 봤어요"));
    expect(radio("이미 해 봤어요")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("아쉬운 점을 하나 골라 주세요.")).toBeNull();
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("키보드: 화살표로 옮기며 고르고 Tab 은 그룹에 한 번만 멈춘다(roving tabindex)", async () => {
    voteRoutes([vote("아빠", false)]);
    renderAt();
    await screen.findByTestId("ask-reask-panel");
    const names = [
      "너무 일반적이에요",
      "이미 해 봤어요",
      "우리 상황과 달라요",
      "더 자세히 알고 싶어요",
    ];
    expect(radio(names[0] ?? "")).toHaveAttribute("tabindex", "0");
    expect(radio(names[1] ?? "")).toHaveAttribute("tabindex", "-1");
    radio(names[0] ?? "").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(radio(names[1] ?? "")).toHaveAttribute("aria-checked", "true");
    expect(radio(names[1] ?? "")).toHaveFocus();
    expect(radio(names[1] ?? "")).toHaveAttribute("tabindex", "0");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(radio(names[3] ?? "")).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowRight}"); // 끝에서 처음으로
    expect(radio(names[0] ?? "")).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowLeft}");
    expect(radio(names[3] ?? "")).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Home}");
    expect(radio(names[0] ?? "")).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{End}");
    expect(radio(names[3] ?? "")).toHaveAttribute("aria-checked", "true");
  });

  it("남은 횟수 안내: 3번 → 2번, 모두 쓰면 「세 번까지예요」 + 다시 답변 버튼 숨김", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ votes: [vote("아빠", false)] }));
    const first = renderAt();
    expect(await screen.findByText("다시 답변을 3번 더 받을 수 있어요.")).toBeInTheDocument();
    first.unmount();
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          votes: [vote("아빠", false)],
          reask: { count: 1, reason: "x", by: "엄마" },
          history: [
            { version: 1, level: 5, createdAt: "2020-01-14T00:00:00.000Z", answer: ANSWER },
          ],
          answer: { level: 5, answer: ANSWER, createdAt: "2020-01-14T05:00:00.000Z", totalMs: 1 },
        }),
      );
    const second = renderAt();
    expect(await screen.findByText("다시 답변을 2번 더 받을 수 있어요.")).toBeInTheDocument();
    second.unmount();
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          votes: [vote("아빠", false)],
          reask: { count: 3, reason: "x", by: "엄마" },
        }),
      );
    renderAt();
    expect(await screen.findByText("다시 답변은 세 번까지예요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 답변 받기" })).toBeNull();
    expect(screen.getByRole("button", { name: "다시 답변 없이 이유만 저장" })).toBeInTheDocument();
  });

  it("이유 + 자유 글 → 표(이유)를 남기고 reask 를 보낸다", async () => {
    voteRoutes([vote("아빠", false)]);
    routes["POST /ask/7/reask"] = () => json(200, { status: "pending", reaskCount: 1 });
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
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

  it("다시 답변을 요청하면 알림 칸에 안내하고 포커스가 진행 상황으로 간다", async () => {
    let asked = false;
    voteRoutes([vote("아빠", false)]);
    routes["GET /ask/7"] = () =>
      asked
        ? json(
            200,
            detail({
              status: "pending",
              answer: undefined,
              reask: { count: 1, reason: "이미 해 봤어요", by: "아빠" },
              history: [
                { version: 1, level: 5, createdAt: "2020-01-15T03:10:00.000Z", answer: ANSWER },
              ],
            }),
          )
        : json(200, detail({ votes: [vote("아빠", false)] }));
    routes["PUT /ask/7/vote"] = () => json(200, { votes: [] });
    routes["POST /ask/7/reask"] = () => {
      asked = true;
      return json(200, { status: "pending", reaskCount: 1 });
    };
    renderAt();
    // 알림 칸은 처음부터 떠 있다(비어 있음)
    expect(await screen.findByTestId("ask-announce")).toBeEmptyDOMElement();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
    await userEvent.click(screen.getByRole("button", { name: "다시 답변 받기" }));
    const progress = await screen.findByRole("heading", { name: "진행 상황" });
    await waitFor(() => {
      expect(progress).toHaveFocus();
    });
    expect(progress).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("ask-announce")).toHaveTextContent("다시 답변을 요청했어요.");
    expect(screen.getByTestId("ask-announce")).toHaveAttribute("aria-live", "polite");
  });

  it("「이유만 저장」 뒤(또는 이유가 있는 👎 로 다시 열면) 링크 버튼으로 패널을 다시 연다", async () => {
    voteRoutes([vote("아빠", false)]);
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "너무 일반적이에요" }));
    await userEvent.click(screen.getByRole("button", { name: "다시 답변 없이 이유만 저장" }));
    await waitFor(() => {
      expect(puts()).toEqual([{ by: "아빠", helpful: false, reason: "너무 일반적이에요" }]);
    });
    expect(calls.some((c) => c.path === "/ask/7/reask")).toBe(false);
    expect(screen.getByTestId("ask-vote-live")).toHaveTextContent("반영했어요");
    // 패널이 닫히고 링크 버튼이 생긴다
    const link = await screen.findByRole("button", { name: "이유 바꾸기·다시 답변 받기" });
    expect(screen.queryByTestId("ask-reask-panel")).toBeNull();
    await userEvent.click(link);
    expect(await screen.findByTestId("ask-reask-panel")).toBeInTheDocument();
    // 저장된 이유가 미리 골라져 있다
    expect(radio("너무 일반적이에요")).toHaveAttribute("aria-checked", "true");
  });

  it("새로고침해도(이유가 이미 있는 👎) 패널은 닫혀 있고 링크 버튼이 보인다", async () => {
    routes["GET /ask/7"] = () =>
      json(200, detail({ votes: [vote("아빠", false, "이미 해 봤어요 · 자유 글")] }));
    renderAt();
    expect(
      await screen.findByRole("button", { name: "이유 바꾸기·다시 답변 받기" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ask-reask-panel")).toBeNull();
  });
});

describe("다시 작성 중·이전 답변", () => {
  const redo = (over: Record<string, unknown> = {}) =>
    detail({
      status: "answering",
      answer: undefined,
      reask: { count: 1, reason: "이미 해 봤어요 · 노래를 불러 줬어요", by: "엄마" },
      history: [{ version: 1, level: 5, createdAt: "2020-01-15T03:10:00.000Z", answer: ANSWER }],
      ...over,
    });

  it("「다시 작성 중」 표시 + 「{누가}가 다시 요청했어요: {이유}」, 이전 답변은 접어 둔다", async () => {
    routes["GET /ask/7"] = () => json(200, redo());
    renderAt();
    expect(
      await screen.findByText("다시 작성 중이에요. 조금만 기다려 주세요."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("다시 작성 중").length).toBeGreaterThan(0);
    expect(screen.getByTestId("ask-reask-by")).toHaveTextContent(
      "엄마가 다시 요청했어요: 이미 해 봤어요",
    );
    expect(screen.getByTestId("ask-reask-by")).not.toHaveTextContent("노래");
    // 이전 답변: 「1번째 답 · 1월 15일」, 기본으로 닫힘
    const summary = screen.getByText("1번째 답 · 1월 15일");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    // 쐐기 아이콘(20px, 스크린리더에서 숨김)
    const chevron = summary.closest("summary")?.querySelector("svg.chevron");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveAttribute("width", "20");
    expect(screen.queryByRole("button", { name: "공유하기" })).toBeNull();
    expect(screen.queryByText("이 답이 도움이 됐나요?")).toBeNull();
  });

  it("받침 있는 이름은 「이」: 아빠→가, 할머니→가, 이모→가, 동생→이", async () => {
    routes["GET /ask/7"] = () =>
      json(200, redo({ reask: { count: 1, reason: "더 자세히 알고 싶어요", by: "동생" } }));
    renderAt();
    expect(await screen.findByTestId("ask-reask-by")).toHaveTextContent(
      "동생이 다시 요청했어요: 더 자세히 알고 싶어요",
    );
  });

  it("다시 답변이 끝나면 이전 표는 지금 답에 대한 표로 세지 않는다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          votes: [vote("아빠", false)], // 04:00 — 새 답(다음 날)보다 이전
          answer: { level: 5, answer: ANSWER, createdAt: "2020-01-16T05:00:00.000Z", totalMs: 1 },
          history: [
            { version: 1, level: 5, createdAt: "2020-01-15T03:10:00.000Z", answer: ANSWER },
          ],
          reask: { count: 1, reason: "x", by: "아빠" },
        }),
      );
    renderAt();
    await screen.findByRole("button", { name: /도움이 안 됐어요/ });
    expect(downBtn()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("ask-reask-panel")).toBeNull();
  });
});

describe("행동 질문이 아닌 답(not_behavior)", () => {
  it("화면에도 공유 글에도 단계가 나오지 않는다", async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      routes["GET /ask/7"] = () =>
        json(
          200,
          detail({
            answer: {
              level: null,
              answer: NOT_BEHAVIOR,
              createdAt: "2020-01-15T03:10:00.000Z",
              totalMs: 1,
            },
          }),
        );
      renderAt();
      const card = await screen.findByRole("article", { name: "답변" });
      expect(card).not.toHaveTextContent("단계");
      expect(card.querySelector(".ask-level")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "공유하기" }));
      const arg = (share.mock.calls as unknown as [{ text: string }][])[0]?.[0];
      expect(arg?.text).toContain("ℹ️ 안내");
      expect(arg?.text).not.toContain("단계");
      expect(arg?.text).not.toContain("📊");
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("이전 답변 목록에서도 단계를 보이지 않는다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          history: [
            {
              version: 1,
              level: null,
              createdAt: "2020-01-15T03:10:00.000Z",
              answer: NOT_BEHAVIOR,
            },
          ],
        }),
      );
    renderAt();
    const summary = await screen.findByText("1번째 답 · 1월 15일");
    const details = summary.closest("details");
    expect(details?.querySelector(".ask-level")).toBeNull();
  });
});

describe("공유하기 · 복사하기 (맨 아래 한 곳)", () => {
  beforeEach(() => {
    routes["GET /ask/7"] = () => json(200, detail());
  });

  it("공유 영역은 맨 아래 한 곳뿐: 라벨 「보낼 내용」, 「짧게/자세히」 라디오", async () => {
    renderAt();
    await screen.findByTestId("ask-share");
    expect(screen.getAllByRole("button", { name: "공유하기" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "복사하기" })).toHaveLength(1);
    expect(screen.getByText("보낼 내용")).toBeVisible();
    const group = screen.getByRole("radiogroup", { name: "보낼 내용" });
    const [short, long] = within(group).getAllByRole("radio");
    expect(short).toHaveAccessibleName("짧게");
    expect(long).toHaveAccessibleName("자세히");
    expect(short).toHaveAttribute("aria-checked", "true");
    expect(long).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("공유한 글은 앱 밖으로 나가요.")).toBeInTheDocument();
    expect(screen.getByText("앱 링크는 가족 PIN이 있어야 열려요.")).toBeInTheDocument();
    // 답 카드 안(요약 아래)에는 더 이상 공유 버튼이 없다
    const card = screen.getByRole("article", { name: "답변" });
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("navigator.share: title·text 만 넘긴다(url 없음, 글 끝에 링크가 있다)", async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      renderAt();
      await userEvent.click(await screen.findByRole("button", { name: "공유하기" }));
      expect(share).toHaveBeenCalledTimes(1);
      const arg = (share.mock.calls as unknown as [Record<string, string>][])[0]?.[0];
      expect(Object.keys(arg ?? {}).sort()).toEqual(["text", "title"]);
      expect(arg?.title).toBe("물어보기 1월 15일");
      expect(arg?.text).toContain("📝 아이 물어보기 (1월 15일 · 질문: 엄마)");
      expect(arg?.text).toContain("1. 안아 주기\n   👉 「많이 속상했구나」");
      expect(arg?.text).toContain(`${window.location.origin}/ask/7`);
      expect(arg?.text).not.toContain("상황 요약"); // 짧게
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("「자세히」를 고르면 기록·근거·한계가 더해진다", async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      renderAt();
      await userEvent.click(await screen.findByRole("radio", { name: "자세히" }));
      expect(screen.getByRole("radio", { name: "자세히" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("radio", { name: "짧게" })).toHaveAttribute("aria-checked", "false");
      await userEvent.click(screen.getByRole("button", { name: "공유하기" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "공유하기" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("복사했어요.")).toBeInTheDocument();
  });

  it("복사하기 버튼은 share 가 있어도 복사한다", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: "복사하기" }));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("복사 실패는 보이는 안내 + 글을 길게 눌러 복사할 수 있는 칸", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: "복사하기" }));
    const msg = await screen.findByText("복사하지 못했어요. 글을 길게 눌러 복사해 주세요.");
    expect(msg).toBeVisible();
    expect(msg.closest("[aria-live]")).not.toBeNull();
    const box = screen.getByRole("textbox", { name: "공유할 글" });
    expect(box).toHaveAttribute("readonly");
    expect((box as HTMLTextAreaElement).value).toContain("📝 아이 물어보기");
  });

  it("공유 취소(AbortError)는 조용히, 다른 공유 실패는 복사로 넘어간다", async () => {
    const share = vi.fn(() => Promise.reject(new DOMException("x", "AbortError")));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      renderAt();
      await userEvent.click(await screen.findByRole("button", { name: "공유하기" }));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/복사/, { selector: "p[role='status']" })).toBeNull();
      expect(writeText).not.toHaveBeenCalled();
      share.mockImplementationOnce(() => Promise.reject(new Error("fail")));
      await userEvent.click(screen.getByRole("button", { name: "공유하기" }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
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
