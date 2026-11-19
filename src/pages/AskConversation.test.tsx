// 물어보기 대화(T-Q5) 화면 시험: 말풍선·입력 잠금·한도·위급 즉시 경고·card_note·카드 갱신 Notice·오프라인·조회 간격·새 뜻의 다시 답변. 합성 자료만.
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import AskDetailPage from "./AskDetailPage";
import AskPage from "./AskPage";
import HomePage from "./HomePage";

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
  level: 7,
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
const REPLY = {
  reply: "밤에는 조용한 목소리로 한 번만 알려 주세요 (합성)",
  say: "지금은 자는 시간이야",
  fromRecords: [
    {
      date: "2020-01-14",
      what: "낮잠 전에 인형을 안았어요 (합성)",
      link: "이어져요",
      source: "알림장",
    },
  ],
  evidence: [],
  cardUpdate: { needed: false, reason: "" },
  limits: "알림장에는 낮 모습만 있어요 (합성)",
};

let turnSeq = 0;
function turn(over: Record<string, unknown> = {}) {
  turnSeq += 1;
  return {
    id: turnSeq,
    seq: turnSeq,
    kind: "followup",
    askedBy: "엄마",
    body: "밤에도 같은 방법을 써도 될까요?",
    reaskReason: null,
    redFlag: false,
    status: "done",
    reply: REPLY,
    reviewScore: 9.6,
    cardStatus: "none",
    cardNote: null,
    cardVersion: null,
    createdAt: "2020-01-15T03:20:00.000Z",
    repliedAt: "2020-01-15T03:21:00.000Z",
    ...over,
  };
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
    answer: { level: 7, answer: ANSWER, createdAt: "2020-01-15T03:10:00.000Z", totalMs: 1 },
    feedback: [],
    votes: [],
    history: [],
    reask: { count: 0, reason: null, by: null },
    workerOnline: true,
    threadActive: false,
    redLock: false,
    cardUpdates: { used: 0, max: 3 },
    turnsUsed: 0,
    originQuestionId: null,
    turns: [],
    ...over,
  };
}

beforeEach(() => {
  turnSeq = 0;
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
  routes["GET /ask/7/instant"] = () => json(200, { notes: [], docs: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderAt(path = "/ask/7") {
  return render(
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
const box = () => screen.findByRole("textbox", { name: "이어서 궁금한 것" });
const sendBtn = () => screen.getByRole("button", { name: "보내기" });
const detailCalls = () => calls.filter((c) => c.method === "GET" && c.path === "/ask/7").length;

describe("말풍선", () => {
  it("질문자 이름·본문, 집 PC의 짧은 답(할 말·기록·한계)이 보이고 이어서 묻기 횟수가 API 값으로 나온다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ turns: [turn()], turnsUsed: 1 }));
    renderAt();
    const list = await screen.findByRole("list", { name: "대화" });
    const [li] = within(list).getAllByRole("listitem");
    if (!li) throw new Error("말풍선이 없어요");
    expect(li).toHaveTextContent("엄마 · ");
    expect(li).toHaveTextContent("밤에도 같은 방법을 써도 될까요?");
    expect(li).toHaveTextContent("밤에는 조용한 목소리로 한 번만 알려 주세요 (합성)");
    expect(li.querySelector(".ask-say")).toHaveTextContent("지금은 자는 시간이야");
    expect(li).toHaveTextContent("2020-01-14 · 알림장");
    expect(li).toHaveTextContent("알림장에는 낮 모습만 있어요 (합성)");
    expect(screen.getByTestId("ask-turn-count")).toHaveTextContent("이어서 묻기 1/10");
  });

  it("카드 안내가 없는 턴의 안내 칸은 비어 있지만 라이브 영역으로 남는다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ turns: [turn()], turnsUsed: 1 }));
    renderAt();
    const live = await screen.findByTestId("ask-turn-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toBeEmptyDOMElement();
  });

  it("짧은 답을 만드는 중이면 진행 단계 문장이 말풍선 안에 보인다(pending·answering·reviewing)", async () => {
    const cases = [
      ["pending", "질문을 받았어요. 집 PC가 곧 집어요."],
      ["answering", "답을 쓰는 중이에요."],
      ["reviewing", "쓴 답을 검토하는 중이에요."],
    ] as const;
    for (const [status, line] of cases) {
      routes["GET /ask/7"] = () =>
        json(
          200,
          detail({ threadActive: true, turns: [turn({ status, reply: null })], turnsUsed: 1 }),
        );
      const view = renderAt();
      expect(await screen.findByText(line)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("짧은 답을 끝내 만들지 못한 턴은 안내와 함께 보인다", async () => {
    routes["GET /ask/7"] = () =>
      json(200, detail({ turns: [turn({ status: "failed", reply: null })], turnsUsed: 1 }));
    renderAt();
    expect(
      await screen.findByText("짧은 답을 만들지 못했어요 · 다시 물어봐 주세요"),
    ).toBeInTheDocument();
  });

  it("다시 답변(reask) 턴은 이유를 보이고 카드 정리 중 문구가 라이브 영역에 있다(질문은 done 유지)", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          threadActive: true,
          turnsUsed: 1,
          turns: [
            turn({
              kind: "reask",
              askedBy: "할머니",
              body: "",
              reaskReason: "이미 해 봤어요 · 노래를 불러 줬어요",
              reply: null,
              cardStatus: "pending",
            }),
          ],
        }),
      );
    renderAt();
    const live = await screen.findByTestId("ask-turn-live");
    expect(live).toHaveTextContent("카드를 다시 정리하는 중이에요");
    const li = live.closest("li");
    expect(li).toHaveTextContent("다시 답변 요청: 이미 해 봤어요");
    // 이전 카드는 그대로 보이고 「새로 정리되는 중」 표시가 붙는다
    expect(screen.getByRole("article", { name: "답변" })).toBeInTheDocument();
    expect(screen.getByTestId("ask-card-redo-top")).toBeInTheDocument();
  });

  it("카드가 갱신되면 「카드가 새로 정리됐어요 (단계 5 → 7)」 — 이력 마지막 단계와 지금 단계를 비교한다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          turnsUsed: 1,
          cardUpdates: { used: 1, max: 3 },
          history: [
            {
              version: 1,
              level: 5,
              createdAt: "2020-01-15T03:10:00.000Z",
              answer: { ...ANSWER, level: 5 },
            },
          ],
          answer: { level: 7, answer: ANSWER, createdAt: "2020-01-15T04:00:00.000Z", totalMs: 1 },
          turns: [turn({ cardStatus: "done", cardVersion: 2 })],
        }),
      );
    renderAt();
    const live = await screen.findByTestId("ask-turn-live");
    expect(live).toHaveTextContent("카드가 새로 정리됐어요 (단계 5 → 7)");
    expect(live.querySelector(".notice")).not.toBeNull();
  });

  it("card_note: limit·redlock 은 고정 문구로", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          turnsUsed: 2,
          turns: [turn({ cardNote: "limit" }), turn({ cardNote: "redlock" })],
        }),
      );
    renderAt();
    expect(await screen.findByText("카드는 세 번까지 다시 만들 수 있어요")).toBeInTheDocument();
    expect(
      screen.getByText(
        "위급 질문이라 카드는 10단계로 유지해요 · 다른 걱정은 새 질문으로 물어봐 주세요",
        {
          selector: "p",
        },
      ),
    ).toBeInTheDocument();
  });

  it("카드가 failed(위급 아님)이면 「카드는 그대로예요」", async () => {
    routes["GET /ask/7"] = () =>
      json(200, detail({ turnsUsed: 1, turns: [turn({ cardStatus: "failed" })] }));
    renderAt();
    expect(await screen.findByText("카드는 그대로예요")).toBeInTheDocument();
  });

  it("이어진 질문 링크(originQuestionId)", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ originQuestionId: 3 }));
    renderAt();
    const link = await screen.findByRole("link", { name: "이어진 질문" });
    expect(link).toHaveAttribute("href", "/ask/3");
  });

  it("옛 서버 응답(대화 필드 없음)도 깨지지 않는다 — 말풍선 없음·입력창 있음·남은 횟수는 reask.count", async () => {
    routes["GET /ask/7"] = () =>
      json(200, {
        question: {
          id: 7,
          askedBy: "엄마",
          body: "합성 질문 본문",
          createdAt: "2020-01-15T03:00:00.000Z",
        },
        status: "done",
        redFlag: false,
        answer: { level: 7, answer: ANSWER, createdAt: "2020-01-15T03:10:00.000Z", totalMs: 1 },
        feedback: [],
        reask: { count: 1, reason: "x", by: "엄마" },
        history: [{ version: 1, level: 5, createdAt: "2020-01-14T00:00:00.000Z", answer: ANSWER }],
        votes: [
          { by: "아빠", helpful: false, reason: null, updatedAt: "2020-01-16T00:00:00.000Z" },
        ],
      });
    renderAt();
    expect(await box()).toBeInTheDocument();
    expect(
      screen.getByText("카드를 읽고 더 궁금한 점이 있으면 이어서 물어봐 주세요."),
    ).toBeInTheDocument();
    expect(await screen.findByText("다시 답변을 2번 더 받을 수 있어요.")).toBeInTheDocument();
  });
});

describe("입력창", () => {
  it("보내기: 1~1000자 본문과 기록자를 POST /turn 으로 보내고, 성공하면 비우고 상세를 다시 본다", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    routes["POST /ask/7/turn"] = () => json(201, { id: 1, seq: 1, redFlag: false });
    renderAt();
    const field = await box();
    expect(sendBtn()).toBeDisabled();
    expect(field).toHaveAttribute("maxlength", "1000");
    await userEvent.type(field, "  밤에도 같은 방법을 써도 될까요?  ");
    expect(sendBtn()).toBeEnabled();
    const before = detailCalls();
    await userEvent.click(sendBtn());
    await waitFor(() => {
      expect(calls.find((c) => c.path === "/ask/7/turn")?.body).toEqual({
        body: "밤에도 같은 방법을 써도 될까요?",
        askedBy: "아빠",
      });
    });
    await waitFor(() => {
      expect(field).toHaveValue("");
    });
    expect(await screen.findByTestId("ask-chat-sent")).toHaveTextContent("보냈어요");
    await waitFor(() => {
      expect(detailCalls()).toBeGreaterThan(before);
    });
  });

  it("활성 턴이 있으면 잠금 문구(짧은 답 단계)와 함께 보내기가 막히지만 글은 미리 쓸 수 있다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          threadActive: true,
          turnsUsed: 1,
          turns: [turn({ status: "answering", reply: null })],
        }),
      );
    renderAt();
    const field = await box();
    expect(screen.getByTestId("ask-chat-lock")).toHaveTextContent(
      "답을 만드는 중이에요 · 끝나면 이어서 물어볼 수 있어요",
    );
    await userEvent.type(field, "이어서 묻고 싶은 것");
    expect(field).toHaveValue("이어서 묻고 싶은 것");
    expect(sendBtn()).toBeDisabled();
    expect(field).toHaveAttribute("aria-describedby", "ask-chat-lock");
  });

  it("카드 단계가 도는 중이면 「카드를 정리하는 중이에요 · 끝나면 이어서 물어볼 수 있어요」", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({ threadActive: true, turnsUsed: 1, turns: [turn({ cardStatus: "pending" })] }),
      );
    renderAt();
    await box();
    const lock = screen.getByTestId("ask-chat-lock");
    expect(lock).toHaveTextContent("카드를 정리하는 중이에요 · 끝나면 이어서 물어볼 수 있어요");
    expect(lock).toHaveAttribute("aria-live", "polite");
    expect(sendBtn()).toBeDisabled();
  });

  it("쓰는 즉시 위급 신호를 알린다(경고 카드) — 잠겨 있어도 위급 글은 바로 보낼 수 있다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          threadActive: true,
          turnsUsed: 1,
          turns: [turn({ status: "answering", reply: null })],
        }),
      );
    routes["POST /ask/7/turn"] = () => json(201, { id: 9, seq: 2, redFlag: true });
    renderAt();
    const field = await box();
    expect(screen.queryByText(/119/)).toBeNull();
    await userEvent.type(field, "자다가 경련을 했어요");
    const warn = await screen.findByText(/119/);
    expect(warn.closest("[data-tone='serious']")).not.toBeNull();
    expect(sendBtn()).toBeEnabled();
    expect(screen.getByTestId("ask-chat-lock")).toHaveTextContent(
      "위급 신호가 있는 글은 바로 보낼 수 있어요",
    );
    await userEvent.click(sendBtn());
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === "/ask/7/turn")).toBe(true);
    });
  });

  it("잠금이 없으면 위급 신호가 없는 글에는 경고가 없다", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    renderAt();
    await userEvent.type(await box(), "낮에는 잘 지내요");
    expect(screen.queryByText(/119/)).toBeNull();
  });

  it("후속 10번을 채우면 입력창 대신 「새 질문으로 이어가기」 — 원 질문 링크가 든 초안으로 /ask 로 간다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ turnsUsed: 10, turns: [turn()] }));
    routes["GET /overview"] = () => json(404, {});
    routes["GET /ask"] = () => json(200, { items: [], nextBefore: null });
    renderAt();
    const go = await screen.findByRole("link", { name: "새 질문으로 이어가기" });
    expect(screen.queryByRole("textbox", { name: "이어서 궁금한 것" })).toBeNull();
    expect(screen.getByText("이어서 묻기는 10번까지 할 수 있어요")).toBeInTheDocument();
    expect(screen.getByTestId("ask-turn-count")).toHaveTextContent("이어서 묻기 10/10");
    await userEvent.click(go);
    const ask = await screen.findByLabelText("궁금한 것");
    expect((ask as HTMLTextAreaElement).value).toContain(`${window.location.origin}/ask/7`);
  });

  it("서버가 새 위급 질문을 만들어 주면(newQuestionId) 그 질문으로 이동한다", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    routes["POST /ask/7/turn"] = () => json(201, { newQuestionId: 12, redFlag: true });
    routes["GET /ask/12"] = () =>
      json(
        200,
        detail({
          question: {
            id: 12,
            askedBy: "아빠",
            body: "새 위급 질문",
            createdAt: "2020-01-15T03:00:00.000Z",
          },
          status: "pending",
          redFlag: true,
          answer: undefined,
          originQuestionId: 7,
        }),
      );
    routes["GET /ask/12/instant"] = () => json(200, { notes: [], docs: [] });
    renderAt();
    await userEvent.type(await box(), "숨을 쉬지 않아요");
    await userEvent.click(sendBtn());
    expect(await screen.findByText("새 위급 질문")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "이어진 질문" })).toHaveAttribute(
      "href",
      "/ask/7",
    );
  });

  it("409 turn_active: 안내하고 상세를 다시 본다(다른 가족의 턴이 보이게)", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    routes["POST /ask/7/turn"] = () =>
      json(409, { error: "turn_active", message: "진행 중인 턴이 있어요." });
    renderAt();
    await userEvent.type(await box(), "이어서 물어요");
    const before = detailCalls();
    await userEvent.click(sendBtn());
    expect(
      await screen.findByText("다른 가족이 먼저 물어봤어요 · 끝나면 이어서 물어볼 수 있어요"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(detailCalls()).toBeGreaterThan(before);
    });
    // 쓴 글은 남아 있다
    expect(screen.getByRole("textbox", { name: "이어서 궁금한 것" })).toHaveValue("이어서 물어요");
  });

  it("429 too_many·turn_limit·그 밖의 오류는 서로 다른 고정 문구(서버 본문은 보이지 않는다)", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    const cases: [number, string, string][] = [
      [429, "too_many", "질문을 너무 많이 보냈어요. 잠시 뒤에 다시 해 주세요."],
      [429, "turn_limit", "이어서 묻기는 10번까지예요"],
      [500, "unknown", "보내지 못했어요. 다시 해 주세요."],
    ];
    for (const [status, error, line] of cases) {
      routes["POST /ask/7/turn"] = () => json(status, { error, message: "SECRET-본문" });
      const view = renderAt();
      await userEvent.type(await box(), "이어서 물어요");
      await userEvent.click(sendBtn());
      expect(await screen.findByText(line)).toBeInTheDocument();
      expect(screen.queryByText(/SECRET/)).toBeNull();
      view.unmount();
    }
  });
});

describe("집 PC 꺼짐·위급 실패·질문 실패", () => {
  it("활성 턴이 있고 집 PC가 꺼져 있으면 「집 PC가 켜지면 답변해요」, 입력 잠금은 그대로", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          workerOnline: false,
          threadActive: true,
          turnsUsed: 1,
          turns: [turn({ status: "pending", reply: null })],
        }),
      );
    renderAt();
    expect(await screen.findByTestId("ask-chat-offline")).toHaveTextContent(
      "집 PC가 켜지면 답변해요.",
    );
    expect(sendBtn()).toBeDisabled();
  });

  it("집 PC가 켜져 있으면 오프라인 문구가 없다", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    renderAt();
    await box();
    expect(screen.queryByTestId("ask-chat-offline")).toBeNull();
  });

  it("위급 턴의 카드가 failed 이면 이전 카드 위에 경고 카드를 고정하고 119 안내를 한다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          redLock: true,
          turnsUsed: 0,
          turns: [turn({ redFlag: true, reply: null, cardStatus: "failed" })],
        }),
      );
    renderAt();
    const fail = await screen.findByTestId("ask-red-failed");
    expect(fail).toHaveTextContent(
      "답을 만들지 못했어요 · 지금 바로 119·응급실·소아과에 연락하세요",
    );
    expect(fail).toHaveAttribute("role", "alert");
    const cards = document.querySelectorAll("[data-tone='serious']");
    expect(cards.length).toBeGreaterThan(0);
    // 이전 카드는 그대로 보인다
    expect(screen.getByRole("article", { name: "답변" })).toBeInTheDocument();
    // 경고 카드는 답 카드보다 앞에 있다
    const [warn] = screen.getAllByText(/119/);
    if (!warn) throw new Error("경고가 없어요");
    const article = screen.getByRole("article", { name: "답변" });
    expect(warn.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("실패한 질문은 입력창 대신 안내와 새 질문 버튼", async () => {
    routes["GET /ask/7"] = () => json(200, { ...detail(), status: "failed", answer: undefined });
    renderAt();
    expect(await screen.findByText("답을 만들지 못한 질문이에요.")).toBeInTheDocument();
    expect(screen.getByText("새 질문으로 물어봐 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새로 질문하기" })).toHaveAttribute("href", "/ask");
    expect(screen.queryByRole("textbox", { name: "이어서 궁금한 것" })).toBeNull();
  });
});

describe("다시 답변(새 뜻): 질문은 done 으로 남고 카드만 다시 만든다", () => {
  const vote = { by: "아빠", helpful: false, reason: null, updatedAt: "2020-01-15T04:00:00.000Z" };

  it("남은 횟수는 cardUpdates 로 센다 — reask.count 가 아니라", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          votes: [vote],
          reask: { count: 3, reason: "x", by: "엄마" },
          cardUpdates: { used: 1, max: 3 },
        }),
      );
    renderAt();
    expect(await screen.findByText("다시 답변을 2번 더 받을 수 있어요.")).toBeInTheDocument();
  });

  it("누르면 표(이유)를 남기고 POST /reask — 화면은 진행 상황이 아니라 대화로 포커스가 가고 질문은 done 그대로", async () => {
    let asked = false;
    routes["GET /ask/7"] = () =>
      json(
        200,
        asked
          ? detail({
              votes: [vote],
              threadActive: true,
              turnsUsed: 1,
              turns: [
                turn({
                  kind: "reask",
                  body: "",
                  reaskReason: "이미 해 봤어요",
                  reply: null,
                  cardStatus: "pending",
                }),
              ],
            })
          : detail({ votes: [vote] }),
      );
    routes["PUT /ask/7/vote"] = () => json(200, { votes: [] });
    routes["POST /ask/7/reask"] = () => {
      asked = true;
      return json(200, { status: "done", reaskCount: 1, id: 1, seq: 1 });
    };
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
    await userEvent.click(screen.getByRole("button", { name: "다시 답변 받기" }));
    const heading = await screen.findByRole("heading", { name: "대화" });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.getByTestId("ask-announce")).toHaveTextContent("다시 답변을 요청했어요.");
    expect(calls.find((c) => c.path === "/ask/7/reask")?.body).toEqual({
      by: "아빠",
      choice: "이미 해 봤어요",
    });
    expect(
      await screen.findByText("카드를 다시 정리하는 중이에요", { selector: "p" }),
    ).toBeInTheDocument();
    // 진행 단계(첫 질문용)는 나오지 않고 카드는 그대로 보인다
    expect(screen.queryByRole("list", { name: "진행 단계" })).toBeNull();
    expect(screen.getByRole("article", { name: "답변" })).toBeInTheDocument();
  });

  it("카드 갱신 3번을 다 쓰면 「카드는 3번까지 …」 + 버튼 숨김", async () => {
    routes["GET /ask/7"] = () =>
      json(200, detail({ votes: [vote], cardUpdates: { used: 3, max: 3 } }));
    renderAt();
    expect(
      await screen.findByText(
        "카드는 3번까지 다시 만들 수 있어요 · 궁금한 점은 이어서 물어봐 주세요",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 답변 받기" })).toBeNull();
  });

  it("위급 잠금이면 버튼이 비활성이고 redlock 문구가 보인다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ votes: [vote], redLock: true }));
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).toBeDisabled();
    expect(
      screen.getByText(
        "위급 질문이라 카드는 10단계로 유지해요 · 다른 걱정은 새 질문으로 물어봐 주세요",
      ),
    ).toBeInTheDocument();
  });

  it("진행 중인 턴이 있으면 버튼이 비활성이고 안내가 보인다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          votes: [vote],
          threadActive: true,
          turnsUsed: 1,
          turns: [turn({ status: "answering", reply: null })],
        }),
      );
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).toBeDisabled();
    expect(
      screen.getByText("카드를 정리하는 중이에요 · 끝나면 다시 요청할 수 있어요"),
    ).toBeInTheDocument();
  });

  it("후속 10번을 채웠으면 다시 답변도 막고 안내한다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ votes: [vote], turnsUsed: 10 }));
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
    expect(screen.getByRole("button", { name: "다시 답변 받기" })).toBeDisabled();
    expect(
      screen.getByText("이어서 묻기는 10번까지예요 · 새 질문으로 이어가 주세요"),
    ).toBeInTheDocument();
  });

  it("409 turn_active 는 상세를 다시 보고 실패 문구를 낸다", async () => {
    routes["GET /ask/7"] = () => json(200, detail({ votes: [vote] }));
    routes["PUT /ask/7/vote"] = () => json(200, { votes: [] });
    routes["POST /ask/7/reask"] = () => json(409, { error: "turn_active", message: "" });
    renderAt();
    await userEvent.click(await screen.findByRole("radio", { name: "이미 해 봤어요" }));
    const before = detailCalls();
    await userEvent.click(screen.getByRole("button", { name: "다시 답변 받기" }));
    expect(
      await screen.findByText("다시 요청하지 못했어요. 잠시 뒤에 해 주세요."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(detailCalls()).toBeGreaterThan(before);
    });
  });
});

describe("상세 조회 간격(5초·30초·60초)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("활성 턴 + 집 PC 켜짐: 5초마다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          threadActive: true,
          turns: [turn({ status: "answering", reply: null })],
          turnsUsed: 1,
        }),
      );
    renderAt();
    await box();
    expect(detailCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(5100);
    expect(detailCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(5100);
    expect(detailCalls()).toBe(3);
  });

  it("활성 턴 + 집 PC 꺼짐: 30초마다(+ 문구), 그 전에는 다시 보지 않는다", async () => {
    routes["GET /ask/7"] = () =>
      json(
        200,
        detail({
          workerOnline: false,
          threadActive: true,
          turns: [turn({ status: "pending", reply: null })],
          turnsUsed: 1,
        }),
      );
    renderAt();
    expect(await screen.findByTestId("ask-chat-offline")).toBeInTheDocument();
    expect(detailCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(detailCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(detailCalls()).toBe(2);
  });

  it("끝났고 활성 턴 없음: 60초마다(다른 가족의 후속이 보이게)", async () => {
    routes["GET /ask/7"] = () => json(200, detail());
    renderAt();
    await box();
    expect(detailCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(detailCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(detailCalls()).toBe(2);
  });

  it("다른 가족의 턴이 보이면 5초 조회로 바뀌고, 끝나면 다시 60초로 돌아간다", async () => {
    let phase = 0;
    routes["GET /ask/7"] = () =>
      json(
        200,
        phase === 0
          ? detail()
          : phase === 1
            ? detail({
                threadActive: true,
                turnsUsed: 1,
                turns: [turn({ status: "answering", reply: null })],
              })
            : detail({ turnsUsed: 1, turns: [turn()] }),
      );
    renderAt();
    await box();
    phase = 1;
    await vi.advanceTimersByTimeAsync(60_500);
    expect(await screen.findByTestId("ask-chat-lock")).toHaveTextContent("답을 만드는 중이에요");
    const atActive = detailCalls();
    phase = 2;
    await vi.advanceTimersByTimeAsync(5100);
    expect(detailCalls()).toBe(atActive + 1);
    await waitFor(() => {
      expect(screen.getByTestId("ask-chat-lock")).toBeEmptyDOMElement();
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(detailCalls()).toBe(atActive + 1);
  });
});

describe("홈: 위급 미처리", () => {
  const ov = (redUnhandled?: number) => ({
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
      ...(redUnhandled === undefined ? {} : { redUnhandled }),
    },
    milestones: { observed: 0, unobserved: 0 },
    recentNotes: [],
    recentLogs: [],
  });
  const renderHome = () =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("redUnhandled > 0 이면 경고 한 줄(건수는 API 값)과 물어보기 링크", async () => {
    routes["GET /overview"] = () => json(200, ov(2));
    renderHome();
    const line = await screen.findByTestId("home-red-unhandled");
    expect(line).toHaveTextContent("위급 질문 처리 못 한 것 2건");
    expect(within(line).getByRole("link", { name: "물어보기에서 보기" })).toHaveAttribute(
      "href",
      "/ask",
    );
  });

  it("0 이거나 옛 서버(필드 없음)면 줄이 없다", async () => {
    for (const v of [0, undefined]) {
      routes["GET /overview"] = () => json(200, ov(v));
      const view = renderHome();
      await screen.findByText("아직 알림장이 없어요.");
      expect(screen.queryByTestId("home-red-unhandled")).toBeNull();
      view.unmount();
    }
  });
});
