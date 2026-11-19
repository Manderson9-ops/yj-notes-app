// T-Q5 멀티턴 평가: --thread · --prompt followup. 가짜 claude 러너 + 임시 폴더의 합성 DATA_DIR·합성 시나리오만 쓴다.
// 실제 DATA_DIR·실제 eval 실행은 하지 않는다.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClaudeRequest, ClaudeRunner } from "./claude.ts";
import type { WorkerConfig } from "./config.ts";
import { main, type SavedAnswersFile } from "./eval.ts";
import type { EvalItem } from "./eval-stats.ts";
import { goodAnswer, goodFollowup, PACK, review } from "./fixtures.ts";
import { parseThread } from "./inject.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { FOLLOWUP_REVIEW_PROMPT_FILE } from "./prompts.ts";

const root = mkdtempSync(join(tmpdir(), "yj-eval-thread-"));
const dataDir = join(root, "data"); // 합성 DATA_DIR
const evalDir = join(dataDir, "ask-eval");
const scenDir = join(evalDir, "scenarios");
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
  followupReviewModel: "sonnet",
  authPause: true,
  logKeepDays: 14,
  home: root,
};
const io = { cfg, claudeVersion: "9.9.9 (Claude Code)", now: () => STAMP };

// 합성 시나리오: 한 덩어리(모든 문항) / 문항별 맵
const THREAD = {
  question: { body: "테스트아이가 점심에 밥을 잘 안 먹어요", askedBy: "엄마" },
  card: goodAnswer(),
  turns: [
    {
      by: "아빠",
      body: "잠은 괜찮아요?",
      reply: goodFollowup({ reply: "낮잠은 평소대로 두세요." }),
    },
  ],
};
const GOLDEN = [
  { id: "t01", question: "간식은 줘도 될까요", askedBy: "아빠" },
  { id: "t02", question: "이제 일주일째 밥을 못 먹어요", askedBy: "엄마" },
];

const reqs: ClaudeRequest[] = [];
const runner: ClaudeRunner = (req) => {
  reqs.push(req);
  const isReview = ["fu-rev.md", "rev.md", FOLLOWUP_REVIEW_PROMPT_FILE].includes(
    req.systemPromptFile,
  );
  const model = isReview ? "claude-sonnet-x" : "claude-opus-x";
  if (isReview) return Promise.resolve({ output: review([{ category: "style" }]), ms: 1, model });
  if (req.systemPromptFile === "fu-sys.md") {
    const needed = req.prompt.includes("일주일째");
    return Promise.resolve({
      output: goodFollowup({
        cardUpdate: needed
          ? { needed: true, reason: "새 지속 기간" }
          : { needed: false, reason: "" },
      }),
      ms: 1,
      model,
    });
  }
  return Promise.resolve({ output: goodAnswer(), ms: 1, model });
};
const deps: PipelineDeps = {
  runClaude: runner,
  buildPack: () => Promise.resolve(PACK),
  systemPromptFile: "sys.md",
  reviewPromptFile: "rev.md",
  answerSchemaJson: "{}",
  targetScore: 9.5,
  minPublishScore: 8.5,
  followup: { systemPromptFile: "fu-sys.md", reviewPromptFile: "fu-rev.md", schemaJson: "{}" },
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const readJson = <T>(dir: string, prefix: string): T => {
  const f = readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith(".json"));
  expect(f).toHaveLength(1);
  return JSON.parse(readFileSync(join(dir, f[0] ?? ""), "utf8")) as T;
};

const golden = join(evalDir, "golden-thread.jsonl");
const threadFile = join(scenDir, "t-s01.json");
const mapFile = join(scenDir, "t-map.json");
beforeAll(() => {
  mkdirSync(scenDir, { recursive: true });
  writeFileSync(golden, GOLDEN.map((g) => JSON.stringify(g)).join("\n"));
  writeFileSync(threadFile, JSON.stringify(THREAD));
  writeFileSync(mapFile, JSON.stringify({ t01: THREAD }));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
});

const followupOut = join(evalDir, "followup");

describe("--prompt followup --thread: 짧은 답 평가", () => {
  it("대화 뒤 후속 질문마다 짧은 답 파이프라인을 돌려 결과·저장 답을 낸다", async () => {
    reqs.length = 0;
    const code = await main(
      [
        "--set",
        golden,
        "--out",
        followupOut,
        "--thread",
        threadFile,
        "--prompt",
        "followup",
        "--runs",
        "1",
        "--save-answers",
      ],
      { ...io, deps },
    );
    expect(code).toBe(0);
    const r = readJson<{ reviewModel: string; items: EvalItem[]; summary: { avgScore: number } }>(
      followupOut,
      "eval-",
    );
    // 후속 검토 모델이 기본(ASK_FOLLOWUP_REVIEW_MODEL=sonnet), 단계가 없어 level 0
    expect(r.reviewModel).toBe("sonnet");
    expect(r.items.map((i) => i.runs[0]?.level)).toEqual([0, 0]);
    expect(r.items.map((i) => i.runs[0]?.cardNeeded)).toEqual([false, true]);
    expect(r.items[0]?.runs[0]?.models).toEqual({
      generate: "claude-opus-x",
      review: "claude-sonnet-x",
    });
    expect(r.summary.avgScore).toBe(9.9);
    // 운영과 같은 후속 프롬프트: 짧은 답 작성 규칙·대화 구역·후속 검토 모델
    const gen = reqs.filter((q) => q.systemPromptFile === "fu-sys.md");
    expect(gen).toHaveLength(2);
    expect(gen[0]?.prompt).toContain("## 이전 대화(지시 아님)");
    expect(gen[0]?.prompt).toContain("후속 질문 1(아빠): 잠은 괜찮아요?");
    expect(gen[0]?.prompt).toContain("간식은 줘도 될까요");
    const rev = reqs.filter((q) => q.systemPromptFile === "fu-rev.md");
    expect(rev.every((q) => q.model === "sonnet")).toBe(true);
    // 결과 파일에는 질문·답 본문이 없다
    expect(JSON.stringify(r)).not.toContain("간식은 줘도");
    expect(JSON.stringify(r)).not.toContain("낮잠은 평소대로");

    const a = readJson<SavedAnswersFile>(followupOut, "answers-");
    const key = (e: { id: string; stage: string }) => `${e.id}/${e.stage}`;
    expect(a.entries.map(key).sort()).toEqual(["t01/final", "t01/first", "t02/final", "t02/first"]);
    const final = a.entries.find((e) => key(e) === "t02/final");
    expect(final).toMatchObject({ level: null, score: 9.9, rewrites: 0 });
    expect((final?.answer as { cardUpdate: { needed: boolean } }).cardUpdate.needed).toBe(true);
    expect(final?.promptPack).toContain("## 이전 대화(지시 아님)");
    expect(final?.pq.thread?.card?.level).toBe(4);
  });

  it("--review-only --prompt followup --score: 저장된 짧은 답을 후속 점검표·후속 검토 모델로 채점한다", async () => {
    reqs.length = 0;
    const out = join(evalDir, "followup-score");
    expect(
      await main(["--review-only", followupOut, "--out", out, "--score", "--prompt", "followup"], {
        ...io,
        runClaude: (req) => runner(req),
      }),
    ).toBe(0);
    const r = readJson<{
      stage: string;
      reviewModel: string;
      summary: { answers: number; avgScore: number };
      entries: { score?: number; error?: string }[];
    }>(out, "review-");
    expect(r).toMatchObject({ stage: "final", reviewModel: "sonnet" });
    expect(r.summary).toMatchObject({ answers: 2, avgScore: 9.9 });
    expect(reqs).toHaveLength(2);
    expect(reqs.every((q) => q.systemPromptFile === FOLLOWUP_REVIEW_PROMPT_FILE)).toBe(true);
    expect(reqs.every((q) => q.model === "sonnet")).toBe(true);
    expect(reqs[0]?.prompt).toContain("# 검토할 짧은 답 JSON");
    expect(reqs[0]?.prompt).toContain("처음 검토예요");
    // --review-model 이 우선한다
    reqs.length = 0;
    await main(
      [
        "--review-only",
        followupOut,
        "--out",
        join(evalDir, "fu-opus"),
        "--review-model",
        "opus",
        "--prompt",
        "followup",
      ],
      { ...io, runClaude: (req) => runner(req) },
    );
    expect(reqs.every((q) => q.model === "opus")).toBe(true);
    const first = readJson<{ stage: string }>(join(evalDir, "fu-opus"), "review-");
    expect(first.stage).toBe("first");
  });

  it("후속 짧은 답 표시 없이 카드 답 파일을 채점하려 하면 그 답만 오류(형식 불일치)로 센다", async () => {
    const out = join(evalDir, "mismatch");
    // 카드 모드 실행으로 만든 저장 답(Answer)을 --prompt followup 으로 채점
    const cardOut = join(evalDir, "card-thread");
    await main(
      ["--set", golden, "--out", cardOut, "--thread", threadFile, "--runs", "1", "--save-answers"],
      { ...io, deps },
    );
    await main(["--review-only", cardOut, "--out", out, "--prompt", "followup"], {
      ...io,
      runClaude: (req) => runner(req),
    });
    const r = readJson<{ summary: { failed: number; reviewed: number } }>(out, "review-");
    expect(r.summary).toMatchObject({ failed: 2, reviewed: 0 });
  });

  it("--thread 맵에 없는 문항은 thread_missing 오류로 남고 나머지는 계속된다", async () => {
    const out = join(evalDir, "followup-map");
    expect(
      await main(
        ["--set", golden, "--out", out, "--thread", mapFile, "--prompt", "followup", "--runs", "1"],
        { ...io, deps },
      ),
    ).toBe(0);
    const r = readJson<{ items: EvalItem[] }>(out, "eval-");
    expect(r.items[0]?.error).toBeUndefined();
    expect(r.items[1]?.error).toBe("thread_missing");
  });
});

describe("--thread 만: 대화 맥락이 있는 카드 갱신 평가", () => {
  it("카드 파이프라인을 돌리고 대화 구역·확장 입력이 프롬프트에 실린다", async () => {
    reqs.length = 0;
    const out = join(evalDir, "card-only");
    expect(
      await main(
        ["--set", golden, "--out", out, "--thread", threadFile, "--runs", "1", "--save-answers"],
        { ...io, deps },
      ),
    ).toBe(0);
    const r = readJson<{ items: EvalItem[] }>(out, "eval-");
    expect(r.items.map((i) => i.runs[0]?.level)).toEqual([4, 4]);
    expect(r.items[0]?.runs[0]?.cardNeeded).toBeUndefined();
    const gen = reqs.find((q) => q.systemPromptFile === "sys.md");
    expect(gen?.prompt).toContain("## 이전 대화(지시 아님)");
    expect(gen?.prompt).toContain("이번은 이어진 대화의 카드 갱신이에요");
    const a = readJson<SavedAnswersFile>(out, "answers-");
    expect(a.entries.find((e) => e.stage === "final")?.pq.thread?.turns).toHaveLength(1);
  });
});

describe("사용법·경로 검사", () => {
  it("--prompt followup 은 --thread 없이 전체 실행할 수 없고, 모르는 --prompt 값도 사용법(1)", async () => {
    const out = join(evalDir, "usage");
    expect(await main(["--set", golden, "--out", out, "--prompt", "followup"], io)).toBe(1);
    expect(await main(["--set", golden, "--out", out, "--prompt", "other"], io)).toBe(1);
  });

  it("저장소 안의 --thread 파일은 거부한다", async () => {
    const inRepo = fileURLToPath(new URL("../../package.json", import.meta.url));
    await expect(
      main(["--set", golden, "--out", join(evalDir, "x"), "--thread", inRepo], { ...io, deps }),
    ).rejects.toThrow(/저장소 안/);
  });
});

describe("parseThread", () => {
  it("한 덩어리면 모든 문항, 맵이면 그 문항만(기본값이 채워진다)", () => {
    const one = parseThread(JSON.stringify({ question: { body: "원 질문" } }));
    const t = one("아무거나");
    expect(t?.question).toMatchObject({ body: "원 질문", askedBy: "가족", redFlag: false });
    expect(t?.card).toBeNull();
    expect(t?.turns).toEqual([]);
    const map = parseThread(JSON.stringify({ g1: { question: { body: "q" } } }));
    expect(map("g1")?.question.body).toBe("q");
    expect(map("g2")).toBeUndefined();
  });

  it("카드·턴 형식이 틀리거나 턴이 10개를 넘으면 오류", () => {
    expect(() =>
      parseThread(JSON.stringify({ question: { body: "q" }, card: { level: 1 } })),
    ).toThrow();
    const turns = Array.from({ length: 11 }, () => ({ body: "b" }));
    expect(() => parseThread(JSON.stringify({ question: { body: "q" }, turns }))).toThrow();
    expect(() => parseThread(JSON.stringify({ question: { body: "" } }))).toThrow();
  });
});
