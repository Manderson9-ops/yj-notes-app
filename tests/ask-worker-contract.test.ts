// 계약 시험: 실제 워커 클라이언트·루프·파이프라인(가짜 claude)을 실제 Hono 앱(가드 포함, 가짜 D1)에 붙여 끝까지 돌린다.
// 세션 API 로 질문 생성 → claim → progress → answer → GET /api/ask/:id 가 done. 합성 자료만(테스트아이).
import { beforeEach, describe, expect, it } from "vitest";
import { goodAnswer, PACK } from "../tools/ask-worker/fixtures.ts";
import { createClient } from "../tools/ask-worker/client.ts";
import { ClaudeError, type ClaudeRunner } from "../tools/ask-worker/claude.ts";
import { createHistoryCache } from "../tools/ask-worker/family.ts";
import { handleOne, type LoopDeps } from "../tools/ask-worker/loop.ts";
import { answerQuestion, type PipelineDeps } from "../tools/ask-worker/pipeline.ts";
import { REVIEW_PROMPT_FILE } from "../tools/ask-worker/prompts.ts";
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
function fakeClaude(opts: { failWith?: string; firstLevelWrong?: boolean } = {}): ClaudeRunner {
  let answers = 0;
  return (req) => {
    if (opts.failWith) return Promise.reject(new ClaudeError(opts.failWith));
    if (req.systemPromptFile === REVIEW_PROMPT_FILE) {
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
