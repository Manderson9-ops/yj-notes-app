// 계약 시험: 실제 워커 클라이언트·루프·파이프라인(가짜 claude)을 실제 Hono 앱(가드 포함, 가짜 D1)에 붙여 끝까지 돌린다.
// 세션 API 로 질문 생성 → claim → progress → answer → GET /api/ask/:id 가 done. 합성 자료만(테스트아이).
import { beforeEach, describe, expect, it } from "vitest";
import { goodAnswer, goodFollowup, PACK } from "../tools/ask-worker/fixtures.ts";
import { createClient, isTurnClaim } from "../tools/ask-worker/client.ts";
import { ClaudeError, type ClaudeRunner } from "../tools/ask-worker/claude.ts";
import { createHistoryCache } from "../tools/ask-worker/family.ts";
import { answerFollowup, cardQuestion } from "../tools/ask-worker/followup.ts";
import { handleOne, type LoopDeps } from "../tools/ask-worker/loop.ts";
import { answerQuestion, type PipelineDeps } from "../tools/ask-worker/pipeline.ts";
import {
  FOLLOWUP_REVIEW_PROMPT_FILE,
  FOLLOWUP_SYSTEM_PROMPT_FILE,
  REVIEW_PROMPT_FILE,
} from "../tools/ask-worker/prompts.ts";
import { sessionCall } from "../server/test-utils/ask";
import {
  cookieFrom,
  createHarness,
  ORIGIN,
  TEST_PIN,
  TEST_WORKER_TOKEN,
  type Harness,
} from "../server/test-utils/harness";

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = await createHarness();
  cookie = cookieFrom(await h.login(TEST_PIN));
});

interface Detail {
  status: string;
  redFlag: boolean;
  answer?: { level: number; reviewScore: number | null };
}
interface Row {
  status: string;
  fail_code: string | null;
  attempts: number;
}

const create = async (body: string): Promise<number> => {
  const res = await sessionCall(h, cookie, "POST", "/api/ask", { body, askedBy: "엄마" });
  expect(res.status).toBe(201);
  return (await res.json<{ id: number }>()).id;
};
const detail = async (id: number): Promise<Detail> => {
  const res = await sessionCall(h, cookie, "GET", `/api/ask/${String(id)}`);
  expect(res.status).toBe(200);
  return await res.json<Detail>();
};
const row = (id: number): Row =>
  h.fake.sqlite
    .prepare("SELECT status, fail_code, attempts FROM ask_question WHERE id = ?")
    .get(id) as unknown as Row;

/** 가짜 claude: 작성 호출은 redFlag 면 10단계, 아니면 4단계를 낸다. 검토는 항상 통과 점수. */
function fakeClaude(
  opts: { failWith?: string; firstLevelWrong?: boolean; cardNeeded?: boolean } = {},
): ClaudeRunner {
  let answers = 0;
  return (req) => {
    if (opts.failWith) return Promise.reject(new ClaudeError(opts.failWith));
    // 후속 짧은 답(T-Q5): 작성은 짧은 답, 검토는 같은 지적 하나
    if (req.systemPromptFile === FOLLOWUP_SYSTEM_PROMPT_FILE) {
      return Promise.resolve({
        output: goodFollowup(
          opts.cardNeeded
            ? { cardUpdate: { needed: true, reason: "새 지속 기간이 나왔어요" } }
            : {},
        ),
        ms: 1,
        model: "claude-opus-5-5",
      });
    }
    if (
      req.systemPromptFile === REVIEW_PROMPT_FILE ||
      req.systemPromptFile === FOLLOWUP_REVIEW_PROMPT_FILE
    ) {
      return Promise.resolve({
        output: {
          issues: [{ category: "style", where: "limits", fix: "조금 줄여요" }],
          previousStatus: [],
        },
        ms: 1,
        model: "claude-opus-5-5",
      });
    }
    answers += 1;
    const red = req.prompt.includes("redFlag: 예");
    const level = red ? (opts.firstLevelWrong && answers === 1 ? 4 : 10) : 4;
    return Promise.resolve({ output: goodAnswer({ level }), ms: 1, model: "claude-opus-5-5" });
  };
}

function loopDeps(runClaude: ClaudeRunner, stages: string[] = [], withHistory = false): LoopDeps {
  const pipe: PipelineDeps = {
    runClaude,
    buildPack: () => Promise.resolve(PACK),
    systemPromptFile: "system.md",
    reviewPromptFile: REVIEW_PROMPT_FILE,
    answerSchemaJson: "{}",
    targetScore: 9.5,
    minPublishScore: 8.5,
    followup: {
      systemPromptFile: FOLLOWUP_SYSTEM_PROMPT_FILE,
      reviewPromptFile: FOLLOWUP_REVIEW_PROMPT_FILE,
      schemaJson: "{}",
    },
  };
  const client = createClient({
    origin: ORIGIN,
    token: TEST_WORKER_TOKEN,
    fetchFn: ((url: string, init: RequestInit) =>
      h.handle(new Request(url, init))) as unknown as typeof fetch,
  });
  if (withHistory) {
    const cache = createHistoryCache(() => client.history(60));
    pipe.getHistory = () => cache.get();
    pipe.today = () => "2030-01-02";
  }
  return {
    client,
    process: (q, hooks, signal) =>
      answerQuestion(pipe, q, { ...hooks, onStage: (s) => stages.push(s) }, signal),
    turn: {
      reply: (c, hooks, signal) =>
        answerFollowup(pipe, c, { ...hooks, onStage: (s) => stages.push(s) }, signal),
      card: (c, hooks, signal) =>
        answerQuestion(pipe, cardQuestion(c), { ...hooks, onStage: (s) => stages.push(s) }, signal),
    },
    log: () => undefined,
    sleep: () => Promise.resolve(),
    pollMs: 10,
    heartbeatMs: 0,
  };
}

describe("워커 클라이언트 ↔ 실제 앱 계약", () => {
  it("질문 생성 → claim → progress → answer → GET 이 done + level, 검토 점수 저장", async () => {
    const id = await create("테스트아이가 밥을 잘 안 먹어요 친구를 때려요");
    expect((await detail(id)).status).toBe("pending");
    const stages: string[] = [];
    const r = await handleOne(loopDeps(fakeClaude(), stages), new AbortController().signal);
    expect(r.claimed).toBe(true);
    const d = await detail(id);
    expect(d.status).toBe("done");
    expect(d.answer?.level).toBe(4);
    expect(d.answer?.reviewScore).toBe(9.9);
    expect(stages).toEqual(["pack", "generate", "review"]);
    const saved = h.fake.sqlite
      .prepare("SELECT review_score, model, work_ms FROM ask_answer WHERE question_id = ?")
      .get(id) as unknown as { review_score: number; model: string; work_ms: number };
    expect(saved).toMatchObject({ review_score: 9.9, model: "claude-opus-5-5" });
    expect(saved.work_ms).toBeGreaterThanOrEqual(0);
    // 대기 질문이 없으면 204 → claimed false
    expect((await handleOne(loopDeps(fakeClaude()), new AbortController().signal)).claimed).toBe(
      false,
    );
  });

  it("실패 경로: fail(code) 로 되돌아가고 3번째 시도 뒤에는 failed", async () => {
    const id = await create("테스트아이가 낮잠을 안 자요 친구를 때려요");
    const deps = loopDeps(fakeClaude({ failWith: "claude_exit" }));
    const sig = new AbortController().signal;
    await handleOne(deps, sig);
    expect(row(id)).toMatchObject({ status: "pending", fail_code: "claude_exit", attempts: 1 });
    await handleOne(deps, sig);
    expect(row(id)).toMatchObject({ status: "pending", attempts: 2 });
    await handleOne(deps, sig);
    expect(row(id)).toMatchObject({ status: "failed", fail_code: "claude_exit", attempts: 3 });
    expect((await detail(id)).status).toBe("failed");
  });

  it("위급 질문이 먼저 claim 되고 level 10 으로만 답이 올라간다", async () => {
    const normal = await create("테스트아이가 장난감을 던져요");
    h.clock.t += 1000;
    const red = await create("자다가 경련을 했어요");
    expect((await detail(red)).redFlag).toBe(true);
    // 첫 작성이 4단계면 결정적 검사가 막고 재작성으로 10단계가 된다
    const deps = loopDeps(fakeClaude({ firstLevelWrong: true }));
    await handleOne(deps, new AbortController().signal);
    expect(row(red).status).toBe("done");
    expect(row(normal).status).toBe("pending");
    expect((await detail(red)).answer?.level).toBe(10);
    await handleOne(deps, new AbortController().signal);
    expect((await detail(normal)).answer?.level).toBe(4);
  });

  it("잘못된 토큰의 워커는 아무것도 못 한다(401), 질문은 그대로 pending", async () => {
    const id = await create("테스트아이가 밥을 안 먹어요 친구를 때려요");
    const bad = createClient({
      origin: ORIGIN,
      token: "wrong-token-0123456789",
      fetchFn: ((url: string, init: RequestInit) =>
        h.handle(new Request(url, init))) as unknown as typeof fetch,
    });
    await expect(bad.claim()).rejects.toMatchObject({ status: 401 });
    expect(row(id).status).toBe("pending");
  });
});

describe("가족 의견·다시 답변 계약 (T-Q3)", () => {
  /** 프롬프트를 기록하는 가짜 claude. */
  const recording = (prompts: string[]): ClaudeRunner => {
    const inner = fakeClaude();
    return (req, signal) => {
      if (req.systemPromptFile !== REVIEW_PROMPT_FILE) prompts.push(req.prompt);
      return inner(req, signal);
    };
  };
  const call = (method: string, path: string, json?: unknown) =>
    sessionCall(h, cookie, method, path, json);

  it("실제 앱 history 응답으로 워커가 가족 결과를 묶음에 넣는다(표·메모 포함)", async () => {
    const first = await create("테스트아이가 밥을 안 먹어요 친구를 때려요");
    await handleOne(loopDeps(fakeClaude()), new AbortController().signal);
    await call("PUT", `/api/ask/${String(first)}/vote`, {
      by: "할머니",
      helpful: false,
      reason: "효과 없었어요",
    });
    await call("POST", `/api/ask/${String(first)}/feedback`, {
      by: "엄마",
      note: "식사 시간을 정해 뒀는데 효과 없었어요",
    });
    const client = createClient({
      origin: ORIGIN,
      token: TEST_WORKER_TOKEN,
      fetchFn: ((url: string, init: RequestInit) =>
        h.handle(new Request(url, init))) as unknown as typeof fetch,
    });
    const hist = await client.history(60);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ id: first, askedBy: "엄마", level: 4 });
    expect(hist[0]?.votes[0]).toMatchObject({ by: "할머니", helpful: false });
    expect(hist[0]?.notes[0]?.note).toContain("효과 없었어요");

    h.clock.t += 1000;
    await create("테스트아이가 점심 밥을 안 먹고 친구를 때려요");
    const prompts: string[] = [];
    await handleOne(loopDeps(recording(prompts), [], true), new AbortController().signal);
    // 질문 확장이 없어도 본문 낱말(밥) 겹침으로 관련 질문이 골라진다
    expect(prompts[0]).toContain("[ref: FAMILY-Q" + String(first) + "]");
    expect(prompts[0]).toContain("효과 없었어요");
  });

  it("다시 답변: 앱의 reask → 워커 claim 이 이전 답·이유를 받아 새 답을 올리고, 이력이 남는다", async () => {
    const id = await create("테스트아이가 밥을 안 먹어요 친구를 때려요");
    await handleOne(loopDeps(fakeClaude()), new AbortController().signal);
    const res = await call("POST", `/api/ask/${String(id)}/reask`, {
      by: "아빠",
      choice: "이미 해 봤어요",
      text: "간식도 줄였어요",
    });
    expect(res.status).toBe(200);
    const prompts: string[] = [];
    h.clock.t += 5000;
    await handleOne(loopDeps(recording(prompts)), new AbortController().signal);
    expect(prompts[0]).toContain("## 다시 답변 요청");
    expect(prompts[0]).toContain("이전 해 볼 것 1: 식사 시간을 정해 두어요");
    expect(prompts[0]).toContain("간식도 줄였어요");
    const d = await (
      await call("GET", `/api/ask/${String(id)}`)
    ).json<{
      status: string;
      history: { version: number }[];
      reask: { count: number };
    }>();
    expect(d.status).toBe("done");
    expect(d.history).toHaveLength(1);
    expect(d.reask.count).toBe(1);
  });

  it("세션 쿠키로는 history 를 못 읽는다(Bearer 전용)", async () => {
    const res = await h.handle(
      new Request(ORIGIN + "/api/worker/ask/history", { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(401);
  });
});

describe("대화 계약 (T-Q5): 후속 질문 → 짧은 답 → 카드 갱신", () => {
  const call = (method: string, path: string, json?: unknown) =>
    sessionCall(h, cookie, method, path, json);
  const rawClient = () =>
    createClient({
      origin: ORIGIN,
      token: TEST_WORKER_TOKEN,
      fetchFn: ((url: string, init: RequestInit) =>
        h.handle(new Request(url, init))) as unknown as typeof fetch,
    });
  interface TurnView {
    seq: number;
    status: string;
    cardStatus: string;
    cardNote: string | null;
    cardVersion: number | null;
    redFlag: boolean;
    reviewScore: number | null;
    reply: { reply: string; cardUpdate: { needed: boolean } } | null;
  }
  interface FullDetail {
    status: string;
    answer: { level: number };
    history: unknown[];
    turns: TurnView[];
    threadActive: boolean;
    cardUpdates: { used: number; max: number };
  }
  const full = async (id: number): Promise<FullDetail> =>
    await (await call("GET", `/api/ask/${String(id)}`)).json<FullDetail>();
  const turn = (id: number, body: string, askedBy = "아빠") =>
    call("POST", `/api/ask/${String(id)}/turn`, { body, askedBy });
  /** 첫 질문을 만들고 워커가 카드를 올린 상태로 만든다. */
  const answered = async (body = "테스트아이가 점심 밥을 안 먹고 친구를 때려요") => {
    const id = await create(body);
    await handleOne(loopDeps(fakeClaude()), new AbortController().signal);
    expect((await detail(id)).status).toBe("done");
    h.clock.t += 1000;
    return id;
  };

  it("claim 의 턴 응답: type·단계·한도·잠금·turn·thread(원 질문·현재 카드·앞선 문답)가 shared 스키마로 파싱된다", async () => {
    const id = await answered();
    const res = await turn(id, "간식은 줘도 될까요");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ seq: 1, redFlag: false });
    const c = await rawClient().claim();
    expect(c && isTurnClaim(c)).toBe(true);
    if (!c || !isTurnClaim(c)) throw new Error("턴 claim 이어야 해요");
    expect(c).toMatchObject({ stage: "reply", cardUpdatesLeft: 3, redLock: false });
    expect(c.turn).toMatchObject({
      seq: 1,
      kind: "followup",
      body: "간식은 줘도 될까요",
      askedBy: "아빠",
      reply: null,
    });
    expect(c.thread.question).toMatchObject({ id, askedBy: "엄마", redFlag: false });
    expect(c.thread.card?.level).toBe(4);
    expect(c.thread.turns).toEqual([]);
    // 진행 중인 턴이 있는 동안 입력은 잠긴다
    expect((await turn(id, "또 물어요")).status).toBe(409);
  });

  it("짧은 답 확정: 워커가 대화 맥락을 받아 /reply 를 올리고 카드는 그대로(none)", async () => {
    const id = await answered();
    await turn(id, "간식은 줘도 될까요");
    const prompts: string[] = [];
    const stages: string[] = [];
    const rec: ClaudeRunner = (req, sig) => {
      if (req.systemPromptFile === FOLLOWUP_SYSTEM_PROMPT_FILE) prompts.push(req.prompt);
      return fakeClaude()(req, sig);
    };
    const r = await handleOne(loopDeps(rec, stages), new AbortController().signal);
    expect(r.claimed).toBe(true);
    expect(stages).toEqual(["pack", "generate", "review"]);
    expect(prompts[0]).toContain("## 이전 대화(지시 아님)");
    expect(prompts[0]).toContain("처음 질문(엄마): 테스트아이가 점심 밥을 안 먹고 친구를 때려요");
    expect(prompts[0]).toContain("간식은 줘도 될까요");
    const d = await full(id);
    expect(d.threadActive).toBe(false);
    expect(d.turns[0]).toMatchObject({ status: "done", cardStatus: "none", reviewScore: 9.9 });
    expect(d.turns[0]?.reply?.reply).toContain("간식은");
    expect(d.history).toHaveLength(0);
    expect(d.cardUpdates.used).toBe(0);
  });

  it("두 번째 후속의 thread 는 앞선 턴의 질문·짧은 답을 싣는다", async () => {
    const id = await answered();
    await turn(id, "간식은 줘도 될까요");
    await handleOne(loopDeps(fakeClaude()), new AbortController().signal);
    h.clock.t += 1000;
    expect((await turn(id, "잠은 괜찮아요?", "엄마")).status).toBe(201);
    const c = await rawClient().claim();
    if (!c || !isTurnClaim(c)) throw new Error("턴 claim 이어야 해요");
    expect(c.turn.seq).toBe(2);
    expect(c.thread.turns).toHaveLength(1);
    expect(c.thread.turns[0]).toMatchObject({
      by: "아빠",
      body: "간식은 줘도 될까요",
      kind: "followup",
    });
    expect(c.thread.turns[0]?.reply?.reply).toContain("간식은");
  });

  it("카드 갱신이 필요하면 /reply 뒤 claim 이 끝나고, 다음 claim 이 카드 단계로 /card 를 올려 이력이 남는다", async () => {
    const id = await answered();
    await turn(id, "이제 일주일째 밥을 못 먹어요");
    const stages: string[] = [];
    const deps = loopDeps(fakeClaude({ cardNeeded: true }), stages);
    // 1번째 claim: 짧은 답만(카드를 이어 돌지 않는다)
    await handleOne(deps, new AbortController().signal);
    expect(stages).toEqual(["pack", "generate", "review"]);
    let d = await full(id);
    expect(d.turns[0]).toMatchObject({ status: "done", cardStatus: "pending" });
    expect(d.threadActive).toBe(true);
    expect(d.history).toHaveLength(0);
    // 2번째 claim: 같은 턴의 카드 단계
    stages.length = 0;
    h.clock.t += 1000;
    const prompts: string[] = [];
    const rec: ClaudeRunner = (req, sig) => {
      if (req.systemPromptFile !== REVIEW_PROMPT_FILE) prompts.push(req.prompt);
      return fakeClaude({ cardNeeded: true })(req, sig);
    };
    await handleOne(loopDeps(rec, stages), new AbortController().signal);
    d = await full(id);
    expect(prompts[0]).toContain("방금 드린 짧은 답");
    expect(prompts[0]).toContain("카드를 다시 만드는 이유: 새 지속 기간이 나왔어요");
    expect(d.turns[0]).toMatchObject({ cardStatus: "done" });
    expect(d.turns[0]?.cardVersion).toBeGreaterThan(0);
    expect(d.history).toHaveLength(1);
    expect(d.cardUpdates.used).toBe(1);
    expect(d.threadActive).toBe(false);
    expect(d.status).toBe("done");
  });

  it("위급 후속: 워커가 카드 단계로 바로 집어 level 10 으로만 올리고 카드 갱신 횟수는 세지 않는다", async () => {
    const id = await answered();
    const res = await turn(id, "방금 경련을 했어요");
    expect(await res.json()).toMatchObject({ redFlag: true });
    const stages: string[] = [];
    await handleOne(
      loopDeps(fakeClaude({ firstLevelWrong: true }), stages),
      new AbortController().signal,
    );
    const d = await full(id);
    expect(d.answer.level).toBe(10);
    expect(d.turns[0]).toMatchObject({ redFlag: true, cardStatus: "done", reply: null });
    expect(d.cardUpdates.used).toBe(0);
    expect(d.history).toHaveLength(1);
  });

  it("옛 서버 호환: ASK_TURN_CLAIM=0 이면 type 없는 질문 응답을 새 워커가 질문으로 처리한다", async () => {
    h.env.ASK_TURN_CLAIM = "0";
    const id = await create("테스트아이가 밥을 안 먹어요 친구를 때려요");
    const c = await rawClient().claim();
    expect(c && isTurnClaim(c)).toBe(false);
    expect(c).toMatchObject({ id, redFlag: false });
    // 같은 claim 이 질문을 잡아 둔 상태가 아니라서 처음부터 다시 돌려 본다
    h.fake.sqlite
      .prepare("UPDATE ask_question SET status = 'pending', lease_until = NULL, attempts = 0")
      .run();
    await handleOne(loopDeps(fakeClaude()), new AbortController().signal);
    expect((await detail(id)).status).toBe("done");
    delete h.env.ASK_TURN_CLAIM;
  });

  it("삭제된 질문의 턴 경로는 404 로 돌아오고 워커는 그 턴을 버린다(질문 처리에 영향 없음)", async () => {
    const id = await answered();
    await turn(id, "간식은 줘도 될까요");
    const c = await rawClient().claim();
    if (!c || !isTurnClaim(c)) throw new Error("턴 claim 이어야 해요");
    await call("DELETE", `/api/ask/${String(id)}`);
    await expect(
      rawClient().turnReply(c.turn.id, {
        reply: goodFollowup(),
        reviewScore: 9.7,
        model: "opus",
        workMs: 1,
        cardWanted: false,
        cardSkip: null,
        cardReason: "",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    // 서버가 turn 경로에 쓰는 오류 모양이 워커가 읽는 code 로 실린다(본문 없음)
    await expect(rawClient().turnProgress(c.turn.id, { stage: "card" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
