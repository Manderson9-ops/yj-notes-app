// T-Q4a: 검토 모델 분리(reviewModel), 첫 작성본 훅(onFirstDraft), 단계별 모델 훅(onModel), 「auth 가 이긴다」.
import { describe, expect, it } from "vitest";
import { ClaudeError, type ClaudeRequest, type ClaudeRunner } from "./claude.ts";
import { goodAnswer, PACK, review } from "./fixtures.ts";
import { answerQuestion, type DraftContext, type PipelineDeps } from "./pipeline.ts";

const q = { body: "테스트아이가 친구를 때려요 밥도 안 먹어요", askedBy: "테스트", redFlag: false };

function setup(script: unknown[], reviewModel?: string) {
  const reqs: ClaudeRequest[] = [];
  const runClaude: ClaudeRunner = (req) => {
    reqs.push(req);
    const next = script.shift();
    if (next === undefined) return Promise.reject(new Error("script empty"));
    if (next instanceof Error) return Promise.reject(next);
    const model = req.systemPromptFile === "rev.md" ? "claude-sonnet-x" : "claude-opus-x";
    return Promise.resolve({ output: next, ms: 5, model });
  };
  const deps: PipelineDeps = {
    runClaude,
    buildPack: () => Promise.resolve(PACK),
    systemPromptFile: "sys.md",
    reviewPromptFile: "rev.md",
    answerSchemaJson: "{}",
    targetScore: 9.5,
    minPublishScore: 8.5,
    ...(reviewModel ? { reviewModel } : {}),
  };
  return { deps, reqs };
}

describe("검토 모델 분리 (ASK_REVIEW_MODEL)", () => {
  it("검토·재검토에만 모델을 넘기고 작성·재작성은 기본(opus)", async () => {
    const { deps, reqs } = setup(
      [
        goodAnswer(),
        review([{ category: "ungrounded" }, { category: "template" }]),
        goodAnswer({ level: 5 }),
        review(
          [],
          [
            { index: 1, fixed: true },
            { index: 2, fixed: true },
          ],
        ),
      ],
      "sonnet",
    );
    const models: [string, string][] = [];
    await answerQuestion(deps, q, { onModel: (s, m) => models.push([s, m]) });
    expect(reqs.map((r) => [r.systemPromptFile, r.model])).toEqual([
      ["sys.md", undefined],
      ["rev.md", "sonnet"],
      ["sys.md", undefined],
      ["rev.md", "sonnet"],
    ]);
    expect(models).toEqual([
      ["generate", "claude-opus-x"],
      ["review", "claude-sonnet-x"],
      ["rewrite", "claude-opus-x"],
      ["review2", "claude-sonnet-x"],
    ]);
  });
  it("설정이 없으면 검토 요청에 model 이 없다(지금과 같은 인자)", async () => {
    const { deps, reqs } = setup([goodAnswer(), review()]);
    await answerQuestion(deps, q);
    expect(reqs[1]?.model).toBeUndefined();
  });
});

describe("첫 작성본 훅 onFirstDraft", () => {
  it("검토 전에 한 번, 검토 입력(묶음·질문·검사 정보)과 함께 — 파이프라인이 예외로 끝나도 이미 불렸다", async () => {
    const { deps } = setup([
      goodAnswer(),
      review([{ category: "factual" }, { category: "factual" }]),
    ]);
    deps.targetScore = 9.5;
    const seen: { hard: number; ctx: DraftContext; level: number | undefined }[] = [];
    const order: string[] = [];
    await expect(
      answerQuestion({ ...deps, runClaude: failRewrite(deps.runClaude) }, q, {
        onFirstDraft: (answer, hard, ctx) => {
          order.push("first");
          seen.push({ hard: hard.length, ctx, level: answer?.level });
        },
        onReviewing: () => {
          order.push("reviewing");
        },
      }),
    ).rejects.toThrow();
    expect(order).toEqual(["first", "reviewing"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.hard).toBe(0);
    expect(seen[0]?.level).toBe(4);
    expect(seen[0]?.ctx.promptPack).toBe(PACK.pack);
    expect(seen[0]?.ctx.pq).toMatchObject({ body: q.body, redFlag: false });
    expect(seen[0]?.ctx.info.refs).toEqual(PACK.refs);
  });
  it("첫 작성이 HARD 여도 불린다(HARD 목록과 함께)", async () => {
    const { deps } = setup([goodAnswer({ level: 2 }), goodAnswer(), review()]);
    const hard: number[] = [];
    await answerQuestion(deps, q, { onFirstDraft: (_a, h) => hard.push(h.length) });
    expect(hard).toHaveLength(1);
    expect(hard[0]).toBeGreaterThan(0);
  });
});

/** 재작성 호출을 실패시키는 감싸개. */
function failRewrite(run: ClaudeRunner): ClaudeRunner {
  let n = 0;
  return (req, signal) =>
    req.systemPromptFile === "sys.md" && ++n > 1
      ? Promise.reject(new ClaudeError("claude_exit"))
      : run(req, signal);
}

describe("auth 가 이긴다", () => {
  it("검토가 auth 로 끝나면 재작성 등 나머지 단계를 하지 않고 exitKind 를 그대로 올린다", async () => {
    const { deps, reqs } = setup([goodAnswer(), new ClaudeError("claude_exit", "auth")]);
    await expect(answerQuestion(deps, q)).rejects.toMatchObject({ exitKind: "auth" });
    expect(reqs).toHaveLength(2);
  });
});
