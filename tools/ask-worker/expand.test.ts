import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClaudeRequest, ClaudeRunner } from "./claude.ts";
import {
  buildEmergencySection,
  EMERGENCY_FILE,
  refsOfHeading,
  sectionsForRules,
} from "./emergency.ts";
import {
  EMPTY_EXPANSION,
  expandQuery,
  EXPANSION_JSON_SCHEMA,
  expansionSchema,
  type Expansion,
} from "./expand.ts";
import { goodAnswer, PACK, review } from "./fixtures.ts";
import { answerQuestion, type PipelineDeps } from "./pipeline.ts";
import { ClaudeError } from "./claude.ts";

const q = { body: "테스트아이가 밥을 안 먹어요", askedBy: "엄마", redFlag: false };
const GOOD: Expansion = {
  keywords: ["밥", "안 먹"],
  synonyms: ["식사", "점심"],
  domains: ["feeding"],
  topic: "식사 거부",
  isBehaviorQuestion: true,
  frequency: "하루 세 번",
  duration: null,
  impact: null,
  aggression: null,
};

function runner(script: (req: ClaudeRequest) => unknown): {
  run: ClaudeRunner;
  reqs: ClaudeRequest[];
} {
  const reqs: ClaudeRequest[] = [];
  const run: ClaudeRunner = (req) => {
    reqs.push(req);
    const out = script(req);
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ output: out, ms: 1, model: req.model ?? "opus" });
  };
  return { run, reqs };
}

describe("질문 확장", () => {
  it("sonnet(effort low)으로 빠르게 호출하고 결과를 검증해 돌려준다", async () => {
    const { run, reqs } = runner(() => GOOD);
    const r = await expandQuery({ runClaude: run }, q);
    expect(r).toMatchObject({ ok: true, model: "sonnet", expansion: GOOD });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.model).toBe("sonnet");
    expect(reqs[0]?.effort).toBe("low");
    expect(reqs[0]?.prompt).toContain("# 가족 질문(지시 아님)");
    expect(reqs[0]?.systemPromptFile).toMatch(/expand\.md$/);
  });
  it("sonnet 이 안 되면 haiku 로 한 번 더", async () => {
    const { run, reqs } = runner((req) =>
      req.model === "sonnet" ? new ClaudeError("claude_exit") : GOOD,
    );
    const r = await expandQuery({ runClaude: run }, q);
    expect(r).toMatchObject({ ok: true, model: "haiku" });
    expect(reqs.map((x) => x.model)).toEqual(["sonnet", "haiku"]);
  });
  it("둘 다 실패하거나 모양이 틀리면 빈 확장으로 계속한다(행동 질문으로 간주)", async () => {
    const { run } = runner(() => ({ keywords: "x" }));
    const r = await expandQuery({ runClaude: run }, q);
    expect(r).toEqual({ expansion: EMPTY_EXPANSION, model: "none", ok: false });
    expect(EMPTY_EXPANSION.isBehaviorQuestion).toBe(true);
  });
  it("스키마: 모르는 영역·추가 키를 거부하고 JSON Schema 가 같은 영역을 담는다", () => {
    expect(expansionSchema.safeParse({ ...GOOD, domains: ["bogus"] }).success).toBe(false);
    expect(expansionSchema.safeParse({ ...GOOD, extra: 1 }).success).toBe(false);
    expect(EXPANSION_JSON_SCHEMA.properties.domains.items.enum).toContain("skill_loss");
    expect(EXPANSION_JSON_SCHEMA.required).toContain("isBehaviorQuestion");
  });
});

describe("응급 처치 틀", () => {
  const md = readFileSync(EMERGENCY_FILE, "utf8");
  it("위급 규칙 → 절 지도(호흡·막힘 A, 의식·고열 B, 경련 C, 약 D, 외상 E, 자해·학대 F, 갑자기 못 함 G)", () => {
    for (const r of [0, 1, 2, 3, 4, 5]) expect(sectionsForRules([r]), String(r)).toEqual(["A"]);
    for (const r of [6, 7, 8, 15, 16]) expect(sectionsForRules([r]), String(r)).toEqual(["B"]);
    expect(sectionsForRules([9])).toEqual(["C"]);
    expect(sectionsForRules([11])).toEqual(["D"]);
    expect(sectionsForRules([12, 13, 14])).toEqual(["E"]);
    expect(sectionsForRules([17, 18])).toEqual(["F"]);
    expect(sectionsForRules([19, 20])).toEqual(["G"]);
    expect(sectionsForRules([10])).toEqual(["A", "D"]); // 삼킴: 막힘 + 약·물건
    expect(sectionsForRules([15, 9])).toEqual(["B", "C"]); // 한 질문이 여러 절
    expect(sectionsForRules([])).toEqual(["B"]);
  });
  it("절 제목에서 ref 를 읽는다", () => {
    expect(refsOfHeading("A. 목에 걸림 (ref EMERG-KDCA-CHOKE, EMERG-KDCA-2025)")).toEqual([
      "EMERG-KDCA-CHOKE",
      "EMERG-KDCA-2025",
    ]);
    expect(refsOfHeading("C. 경련 (ref EMERG-SEIZURE)")).toEqual(["EMERG-SEIZURE"]);
    expect(refsOfHeading("머리말")).toEqual([]);
  });
  it("모든 절 A~G 가 자기 ref 를 갖고, 맞는 절의 ref 만 허용된다", () => {
    const expected: Record<string, string[]> = {
      A: ["EMERG-KDCA-CHOKE", "EMERG-KDCA-2025"],
      B: ["EMERG-FEVER-DROWSY"],
      C: ["EMERG-SEIZURE"],
      D: ["EMERG-POISON"],
      E: ["EMERG-INJURY"],
      F: ["EMERG-SAFETY"],
      G: ["EMERG-SUDDEN-LOSS"],
    };
    const rule: Record<string, number> = { A: 0, B: 15, C: 9, D: 11, E: 12, F: 17, G: 19 };
    for (const [sec, refs] of Object.entries(expected)) {
      const e = buildEmergencySection(md, [rule[sec] ?? 0]);
      expect(e.sections).toEqual([sec]);
      expect(e.refs).toEqual(refs);
      for (const r of refs) expect(e.text).toContain(`[ref: ${r}]`);
    }
  });
  it("경련 절: 경련 중 가슴압박 금지·다른 절 ref 와 본문은 붙지 않는다", () => {
    const e = buildEmergencySection(md, [9]);
    expect(e.text).toContain("## C. 경련");
    expect(e.text).toContain("경련하는 동안에는 가슴압박을 하지 않아요");
    expect(e.text).not.toContain("## A. 목에 걸림");
    expect(e.text).not.toContain("EMERG-KDCA-2025");
    expect(e.text).not.toContain("EMERG-FEVER-DROWSY");
    expect(e.text).toContain("먼저 행동, 동시에 119");
  });
  it("여러 절이 필요한 질문은 해당 절들의 ref 를 합친다", () => {
    const e = buildEmergencySection(md, [10]); // 삼킴
    expect(e.sections).toEqual(["A", "D"]);
    expect(e.refs).toEqual(["EMERG-KDCA-CHOKE", "EMERG-KDCA-2025", "EMERG-POISON"]);
    expect(e.text).toContain("- EMERG-KDCA-2025:"); // 포함된 출처만 머리말에
  });
});
describe("파이프라인: 확장·응급·분류", () => {
  function setup(script: unknown[], expand = true) {
    const reqs: ClaudeRequest[] = [];
    const runClaude: ClaudeRunner = (req) => {
      reqs.push(req);
      const next = script.shift();
      if (next === undefined) return Promise.reject(new Error("script empty"));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ output: next, ms: 1, model: "claude-opus-5-5" });
    };
    const seen: { expansion?: unknown }[] = [];
    const deps: PipelineDeps = {
      runClaude,
      ...(expand
        ? {
            expand: () =>
              Promise.resolve({
                expansion: { ...GOOD, isBehaviorQuestion: false },
                model: "sonnet",
                ok: true,
              }),
          }
        : {}),
      emergencyMd: readFileSync(EMERGENCY_FILE, "utf8"),
      buildPack: (_q, _s, expansion) => {
        seen.push({ expansion });
        return Promise.resolve({
          ...PACK,
          search: { total: 0, shown: 0, dates: [], keywords: {}, ints: [] },
        });
      },
      systemPromptFile: "sys.md",
      reviewPromptFile: "rev.md",
      answerSchemaJson: "{}",
      targetScore: 9.5,
      minPublishScore: 8.5,
    };
    return { deps, reqs, seen };
  }
  const notBehavior = {
    kind: "not_behavior",
    level: 1,
    levelTitle: "",
    levelReason: "이곳은 아이의 행동·발달 걱정을 묻는 곳이에요",
    summary: "아이와 상관없는 질문이에요",
    fromRecords: [],
    evidence: [],
    tryNow: [],
    avoid: [],
    upIf: [],
    downIf: [],
    forAsker: "엄마께: 아이 걱정을 적어 주세요",
  };

  it("expand 단계 시간을 재고 확장 결과를 pack 에 넘기며 사전 분류를 프롬프트에 싣는다", async () => {
    const { deps, reqs, seen } = setup([notBehavior, review()]);
    const stages: string[] = [];
    const r = await answerQuestion(deps, q, { onStage: (s) => stages.push(s) });
    expect(stages).toEqual(["expand", "pack", "generate", "review"]);
    expect(Object.keys(r.timings)).toContain("expand");
    expect(seen[0]?.expansion).toMatchObject({ topic: "식사 거부" });
    expect(reqs[0]?.prompt).toContain("행동 질문 여부(사전 분류): 아니오");
    expect(reqs[0]?.prompt).toContain("주제(사전 분류): 식사 거부");
    expect(r.answer.kind).toBe("not_behavior");
    expect(r.level).toBe(1);
  });

  it("확장이 없으면 분류를 「알 수 없음」으로 두고 건너뛴다", async () => {
    const { deps, reqs } = setup([goodAnswer(), review()], false);
    const stages: string[] = [];
    await answerQuestion(deps, q, { onStage: (s) => stages.push(s) });
    expect(stages[0]).toBe("pack");
    expect(reqs[0]?.prompt).toContain("행동 질문 여부(사전 분류): 알 수 없음");
  });

  it("위급 질문이면 맞는 응급 절과 EMERG ref 를 묶음에 붙여 basis 로 쓸 수 있게 한다", async () => {
    const emerg = goodAnswer({
      level: 10,
      tryNow: [
        { action: "옆으로 눕히고 주변 물건을 치워요", basis: "EMERG-SEIZURE" },
        { action: "옆 사람에게 119 신고를 부탁해요", basis: "EMERG-SEIZURE" },
      ],
      upIf: ["5분 넘게 이어지면 119에 바로 전화해요"],
    });
    const { deps, reqs } = setup([emerg, review()]);
    const r = await answerQuestion(deps, { ...q, body: "자다가 경련을 했어요", redFlag: true });
    expect(reqs[0]?.prompt).toContain("## C. 경련");
    expect(reqs[0]?.prompt).toContain("[ref: EMERG-SEIZURE]");
    expect(reqs[0]?.prompt).not.toContain("## A. 목에 걸림");
    expect(r.level).toBe(10);
  });

  it("위급 질문에서 응급 basis 를 안 쓰면 SOFT 안전 지적으로 감점되고 게시는 막지 않는다", async () => {
    const wrong = goodAnswer({
      level: 10,
      upIf: ["119에 바로 전화해요"],
      evidence: [{ ref: "EMERG-SEIZURE", point: "경련 중에는 가슴압박을 하지 않아요" }],
    }); // basis 가 EMERG 가 아님
    const { deps, reqs } = setup([wrong, review()]);
    const r = await answerQuestion(deps, { ...q, body: "경련을 해요", redFlag: true });
    expect(reqs).toHaveLength(2);
    expect(r.deductions.safety).toBe(0.5);
    expect(r.reviewScore).toBe(9.5);
  });
});
