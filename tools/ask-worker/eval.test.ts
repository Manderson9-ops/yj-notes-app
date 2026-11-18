// T-Q4a 평가 도구: 가짜 claude 러너 + 시험용 임시 폴더의 합성 DATA_DIR(합성 골든 세트)로 새 옵션을 한 번씩 돌려 출력 형식을 본다.
// 실제 DATA_DIR·실제 질문은 쓰지 않는다.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClaudeError, type ClaudeRequest, type ClaudeRunner } from "./claude.ts";
import type { WorkerConfig } from "./config.ts";
import { errorTag, main, parseSavedAnswers, type SavedAnswersFile } from "./eval.ts";
import {
  classifyEvalError,
  compareEvals,
  compareMain,
  countErrors,
  type EvalItem,
} from "./eval-stats.ts";
import { goodAnswer, PACK, review } from "./fixtures.ts";
import { PipelineError, type PipelineDeps } from "./pipeline.ts";
import { REVIEW_PROMPT_FILE } from "./prompts.ts";

// 합성 골든 세트: g01 정상, g02 검토에서 도구 실패, g03 첫 작성 HARD(단계 2) → 재작성으로 게시
const GOLDEN = [
  { id: "g01", question: "테스트아이가 친구를 때려요 밥도 안 먹어요" },
  { id: "g02", question: "테스트아이가 친구를 때려요 낮잠도 안 자요" },
  { id: "g03", question: "테스트아이가 친구를 때려요 손을 안 씻어요" },
];

const root = mkdtempSync(join(tmpdir(), "yj-eval-t-"));
const dataDir = join(root, "data"); // 합성 DATA_DIR
const evalDir = join(dataDir, "ask-eval");
const STAMP = new Date("2020-03-05T01:02:03.000Z");
const cfg: WorkerConfig = {
  origin: "",
  token: "",
  pythonBin: "python",
  claudeBin: "claude",
  dataDir,
  birthDate: "",
  pollMs: 10_000,
  targetScore: 9.5,
  minPublishScore: 8.5,
  claudeTimeoutMs: 240_000,
  expandModel: "sonnet",
  reviewModel: "opus",
  authPause: true,
  logKeepDays: 14,
  home: root,
};
const io = { cfg, claudeVersion: "9.9.9 (Claude Code)", now: () => STAMP };

const reqs: ClaudeRequest[] = [];
let handGen = 0;
const fullRunner: ClaudeRunner = (req) => {
  reqs.push(req);
  if (req.systemPromptFile === REVIEW_PROMPT_FILE) {
    if (req.prompt.includes("낮잠")) return Promise.reject(new ClaudeError("claude_exit", "other"));
    return Promise.resolve({
      output: review([{ category: "style" }]),
      ms: 1,
      model: "claude-sonnet-x",
    });
  }
  const level = req.prompt.includes("손을") && ++handGen % 2 === 1 ? 2 : 4;
  return Promise.resolve({ output: goodAnswer({ level }), ms: 1, model: "claude-opus-x" });
};
const deps: PipelineDeps = {
  runClaude: fullRunner,
  buildPack: () => Promise.resolve(PACK),
  systemPromptFile: "sys.md",
  reviewPromptFile: REVIEW_PROMPT_FILE,
  answerSchemaJson: "{}",
  targetScore: 9.5,
  minPublishScore: 8.5,
};

// 읽은 JSON 의 모양은 호출부가 정한다(시험 도우미).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const readJson = <T>(dir: string, prefix: string): T => {
  const f = readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith(".json"));
  expect(f).toHaveLength(1);
  return JSON.parse(readFileSync(join(dir, f[0] ?? ""), "utf8")) as T;
};

const fullOut = join(evalDir, "full");
beforeAll(async () => {
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, "golden.jsonl"), GOLDEN.map((g) => JSON.stringify(g)).join("\n"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const code = await main(
    [
      "--set",
      join(evalDir, "golden.jsonl"),
      "--out",
      fullOut,
      "--runs",
      "2",
      "--save-answers",
      "--review-model",
      "sonnet",
    ],
    { ...io, deps },
  );
  expect(code).toBe(0);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("전체 실행: --review-model · 오류 단계 꼬리표 · 모델 ID · claude --version", () => {
  it("결과 머리와 문항별 기록", () => {
    const r = readJson<{ claudeVersion: string; reviewModel: string; items: EvalItem[] }>(
      fullOut,
      "eval-",
    );
    expect(r.claudeVersion).toBe("9.9.9 (Claude Code)");
    expect(r.reviewModel).toBe("sonnet");
    const [g01, g02, g03] = r.items;
    expect(g01?.runs).toHaveLength(2);
    expect(g01?.runs[0]?.models).toEqual({ generate: "claude-opus-x", review: "claude-sonnet-x" });
    expect(g02?.error).toBe("review:claude_exit");
    expect(g03?.runs[0]?.models).toEqual({
      generate: "claude-opus-x",
      rewrite: "claude-opus-x",
      review2: "claude-sonnet-x",
    });
    // 검토·재검토 요청만 --review-model 을 쓴다
    const reviewModels = new Set(
      reqs.filter((q) => q.systemPromptFile === REVIEW_PROMPT_FILE).map((q) => q.model),
    );
    expect([...reviewModels]).toEqual(["sonnet"]);
    expect(
      reqs
        .filter((q) => q.systemPromptFile !== REVIEW_PROMPT_FILE)
        .every((q) => q.model === undefined),
    ).toBe(true);
  });

  it("--save-answers 형식 2: 첫 작성본(예외로 끝나도)·최종 답, 검토 입력 함께, HARD 첫 작성은 「첫 작성본 없음」", () => {
    const a = readJson<SavedAnswersFile>(fullOut, "answers-");
    expect(a).toMatchObject({
      format: 2,
      claudeVersion: "9.9.9 (Claude Code)",
      reviewModel: "sonnet",
    });
    const key = (e: { id: string; run: number; stage: string }) =>
      `${e.id}/${String(e.run)}/${e.stage}`;
    expect(a.entries.map(key).sort()).toEqual(
      [
        "g01/0/first",
        "g01/0/final",
        "g01/1/first",
        "g01/1/final",
        "g02/0/first",
        "g03/0/final",
        "g03/1/final",
      ].sort(),
    );
    expect(a.noFirstDraft).toEqual([
      { id: "g03", run: 0 },
      { id: "g03", run: 1 },
    ]);
    for (const e of a.entries) {
      expect(e.promptPack).toBe(PACK.pack);
      expect(e.pq).toMatchObject({ redFlag: false });
      expect(e.info.refs).toEqual(PACK.refs);
    }
    const final = a.entries.find((e) => e.stage === "final");
    expect(final).toMatchObject({ score: 9.9, rewrites: 0 });
    expect(a.entries.find((e) => e.stage === "first")?.score).toBeUndefined();
  });
});

describe("--review-only · --score", () => {
  const reviewRunner = (bad: string): ClaudeRunner & { reqs: ClaudeRequest[] } => {
    const seen: ClaudeRequest[] = [];
    const run: ClaudeRunner = (req) => {
      seen.push(req);
      const output = req.prompt.includes(bad)
        ? { nope: 1 }
        : review([{ category: "ungrounded" }, { category: "style" }]);
      return Promise.resolve({ output, ms: 1, model: "claude-opus-y" });
    };
    return Object.assign(run, { reqs: seen });
  };

  it("첫 작성본에 검토만: 답별 범주별 검토자 지적 수, 실패 답은 따로", async () => {
    const out = join(evalDir, "ro");
    const run = reviewRunner("낮잠");
    expect(
      await main(["--review-only", fullOut, "--out", out, "--review-model", "opus"], {
        ...io,
        runClaude: run,
      }),
    ).toBe(0);
    const r = readJson<{
      stage: string;
      reviewModel: string;
      source: string;
      summary: { answers: number; reviewed: number; failed: number; issueTotal: number };
      entries: { id: string; model?: string; counts?: Record<string, number>; error?: string }[];
    }>(out, "review-");
    expect(r).toMatchObject({ stage: "first", reviewModel: "opus" });
    expect(r.source).toMatch(/^answers-/);
    expect(r.summary).toEqual(
      expect.objectContaining({ answers: 3, reviewed: 2, failed: 1, issueTotal: 4 }),
    );
    expect(r.entries[0]).toMatchObject({
      id: "g01",
      model: "claude-opus-y",
      counts: { ungrounded: 1, style: 1, factual: 0 },
    });
    expect(r.entries.find((e) => e.id === "g02")?.error).toBe("review:review_invalid");
    // 운영 첫 검토와 같은 입력: 저장된 묶음 + 처음 검토 문구, 모델은 옵션
    expect(run.reqs[0]?.prompt.startsWith(PACK.pack)).toBe(true);
    expect(run.reqs[0]?.prompt).toContain("처음 검토예요");
    expect(
      run.reqs.every((q) => q.model === "opus" && q.systemPromptFile === REVIEW_PROMPT_FILE),
    ).toBe(true);
  });

  it("--score: 최종 답에 검토자 지적 + 코드 SOFT 로 운영 점수식 점수와 평균", async () => {
    const out = join(evalDir, "score");
    expect(
      await main(["--review-only", fullOut, "--out", out, "--score"], {
        ...io,
        runClaude: reviewRunner("없는-표지"),
      }),
    ).toBe(0);
    const r = readJson<{
      stage: string;
      reviewModel: string;
      summary: { answers: number; avgScore: number };
      entries: { score?: number }[];
    }>(out, "review-");
    expect(r.stage).toBe("final");
    expect(r.reviewModel).toBe("opus"); // 옵션이 없으면 worker.env 의 ASK_REVIEW_MODEL
    expect(r.summary.answers).toBe(4);
    expect(r.entries.map((e) => e.score)).toEqual([9.4, 9.4, 9.4, 9.4]); // 10 − ungrounded 0.5 − style 0.1
    expect(r.summary.avgScore).toBe(9.4);
  });

  it("형식 2 가 아닌(T-Q4a 이전) 저장 파일은 받지 않는다", async () => {
    const dir = join(evalDir, "old");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "answers-old.json"),
      JSON.stringify([{ id: "g01", run: 0, answer: {} }]),
    );
    await expect(main(["--review-only", dir, "--out", join(evalDir, "x")], io)).rejects.toThrow(
      /형식 2/,
    );
    expect(() => parseSavedAnswers('{"format":2,"entries":[{"id":"a"}]}')).toThrow();
  });

  it("잘못된 --review-model·필수 인자 누락은 사용법(1)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await main(["--set", "x", "--out", join(evalDir, "y"), "--review-model", "a b"], io),
    ).toBe(1);
    expect(await main(["--out", join(evalDir, "y")], io)).toBe(1);
  });
});

describe("오류 단계 꼬리표와 비교 모드", () => {
  it("errorTag: 「마지막 단계:코드」", () => {
    expect(errorTag("review", new ClaudeError("claude_exit", "auth"))).toBe("review:claude_exit");
    expect(errorTag("review2", new PipelineError("low_score"))).toBe("review2:low_score");
    expect(errorTag("", new Error("x".repeat(50)))).toBe("x".repeat(40));
  });

  it("classifyEvalError: ⓐ 검토 단계 · ⓑ low_score(단계 무관) · ⓒ unreviewed · 그 밖 작성 단계", () => {
    expect(classifyEvalError("review:claude_exit")).toBe("review");
    expect(classifyEvalError("review2:review_invalid")).toBe("review");
    expect(classifyEvalError("rewrite:low_score")).toBe("low_score");
    expect(classifyEvalError("unreviewed")).toBe("unreviewed");
    expect(classifyEvalError("generate:claude_exit")).toBe("authoring");
    expect(classifyEvalError("claude_exit")).toBe("authoring"); // 꼬리표 없는 옛 결과
  });

  it("교집합 평균·단계 일관성 비율, 실행별 오류 수(문항 단위), 세트 id 집합 확인", () => {
    const a = readJson<{ claudeVersion: string; reviewModel: string; items: EvalItem[] }>(
      fullOut,
      "eval-",
    );
    const run = (level: number, score: number) => ({ ...a.items[0]!.runs[0]!, level, score });
    const b = {
      reviewModel: "opus",
      items: [
        { id: "g01", runs: [run(4, 9.0), run(7, 9.2)] },
        { id: "g02", runs: [run(4, 9.6), run(4, 9.6)] },
        { id: "g03", runs: [], error: "rewrite:low_score" },
      ],
    };
    const c = compareEvals(a, b, ["A", "B"], ["g01", "g02", "g03"]);
    expect(c.intersection).toEqual(["g01"]);
    expect(c.a).toMatchObject({
      reviewModel: "sonnet",
      avgScore: 9.9,
      levelRatio: 1,
      idSetMatchesSet: true,
    });
    expect(c.b).toMatchObject({
      reviewModel: "opus",
      avgScore: 9.1,
      levelConsistent: 0,
      levelChecked: 1,
      levelRatio: 0,
    });
    expect(c.a.errors).toEqual({ review: 1, lowScore: 0, unreviewed: 0, gate: 1, authoring: 0 });
    expect(c.b.errors).toEqual({ review: 0, lowScore: 1, unreviewed: 0, gate: 1, authoring: 0 });
    expect(compareEvals(a, b, ["A", "B"], ["g01", "g02"]).a.idSetMatchesSet).toBe(false);
    expect(countErrors([{ id: "x", runs: [], error: "pack:pack_failed" }]).authoring).toBe(1);
  });

  it("CLI: 폴더·파일을 받아 JSON 을 낸다", () => {
    const other = join(evalDir, "other");
    mkdirSync(other, { recursive: true });
    const a = readJson<{ items: EvalItem[] }>(fullOut, "eval-");
    writeFileSync(
      join(other, "eval-x.json"),
      JSON.stringify({ reviewModel: "opus", items: a.items.slice(0, 1) }),
    );
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    expect(
      compareMain([
        "--compare",
        fullOut,
        join(other, "eval-x.json"),
        "--set",
        join(evalDir, "golden.jsonl"),
      ]),
    ).toBe(0);
    const c = JSON.parse(logs.join("\n")) as {
      intersection: string[];
      b: { idSetMatchesSet: boolean };
    };
    expect(c.intersection).toEqual(["g01"]);
    expect(c.b.idSetMatchesSet).toBe(false);
  });
});
