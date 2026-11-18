// T-Q4a: 미리 띄우기 벤치 — 채택 판정 규칙과 가짜 claude 로 짧게 한 번 돌린 결과 모양.
import { describe, expect, it } from "vitest";
import { makeFakeClaude } from "./fake-claude.ts";
import {
  decide,
  median,
  runBench,
  type OverlapRun,
  type Pair,
  type TimedRun,
} from "./prespawn-bench.ts";

const t = (mode: "immediate" | "delayed", ms: number, code: number | null = 0): TimedRun => ({
  mode,
  writeToExitMs: ms,
  spawnToExitMs: ms,
  code,
});
const pair = (imm: number, del: number): Pair => ({
  order: ["immediate", "delayed"],
  immediate: t("immediate", imm),
  delayed: t("delayed", del),
});
const okOverlap: OverlapRun[] = Array.from({ length: 10 }, () => ({
  a: t("immediate", 9000),
  b: t("delayed", 4000),
}));

describe("채택 판정", () => {
  it("중앙값 ≥ 3s 그리고 4/5 쌍 이상 정한 방향, 겹쳐 띄우기 비정상 종료 0 이면 채택", () => {
    const pairs = [
      pair(9000, 5000),
      pair(9500, 5000),
      pair(8000, 4500),
      pair(9000, 9500),
      pair(10000, 5500),
    ];
    const d = decide(pairs, okOverlap);
    expect(d).toMatchObject({ medianDiffMs: 4000, direction: 4, directionNeeded: 4, adopt: true });
  });
  it("방향 3/5 이면 불채택, 중앙값 3s 미만이면 불채택", () => {
    const three = [
      pair(9000, 5000),
      pair(9500, 5000),
      pair(8000, 4500),
      pair(4000, 9500),
      pair(4000, 5500),
    ];
    expect(decide(three, okOverlap).adopt).toBe(false);
    const small = [
      pair(6000, 5000),
      pair(6000, 5000),
      pair(6000, 5000),
      pair(6000, 5000),
      pair(6000, 5000),
    ];
    expect(decide(small, okOverlap)).toMatchObject({
      medianDiffMs: 1000,
      direction: 5,
      adopt: false,
    });
  });
  it("겹쳐 띄우기에서 비정상 종료가 1번이라도 나면 불채택(시간 초과는 따로 센다)", () => {
    const pairs = Array.from({ length: 5 }, () => pair(9000, 5000));
    const bad = [
      ...okOverlap.slice(1),
      { a: t("immediate", 1000, 1), b: t("delayed", 1000, null) },
    ];
    expect(decide(pairs, bad)).toMatchObject({ overlapAbnormal: 1, overlapOther: 1, adopt: false });
  });
  it("겹쳐 띄우기의 시간 초과만 있어도 불채택", () => {
    const pairs = Array.from({ length: 5 }, () => pair(9000, 5000));
    const slow = [...okOverlap.slice(1), { a: t("immediate", 1000), b: t("delayed", 1000, null) }];
    expect(decide(pairs, slow)).toMatchObject({
      overlapAbnormal: 0,
      overlapOther: 1,
      adopt: false,
    });
  });
  it("실패한 쌍이 있으면 불채택", () => {
    const pairs = [
      ...Array.from({ length: 4 }, () => pair(9000, 5000)),
      { ...pair(9000, 5000), delayed: t("delayed", 0, 1) },
    ];
    expect(decide(pairs, okOverlap)).toMatchObject({ failedPairs: 1, adopt: false });
  });
  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("가짜 claude 로 짧게 한 번", () => {
  it("쌍마다 순서를 번갈아 바꾸고, 6초 뒤 쓰기는 쓰기 시점부터 잰다", async () => {
    const fake = makeFakeClaude();
    const r = await runBench(
      {
        bin: fake.bin,
        argsPrefix: fake.argsPrefix,
        home: fake.home,
        model: "opus",
        delayMs: 300,
        timeoutMs: 10_000,
      },
      { pairs: 2, overlap: 1 },
    );
    expect(r.pairs.map((p) => p.order)).toEqual([
      ["immediate", "delayed"],
      ["delayed", "immediate"],
    ]);
    for (const p of r.pairs) {
      expect(p.immediate.code).toBe(0);
      expect(p.delayed.code).toBe(0);
      expect(p.delayed.spawnToExitMs - (p.delayed.writeToExitMs ?? 0)).toBeGreaterThanOrEqual(250);
    }
    expect(r.overlap).toHaveLength(1);
    expect(r.decision.overlapAbnormal).toBe(0);
    expect(r.decision.diffsMs).toHaveLength(2);
  });
  it("쓰기 전에 프로세스가 끝나면 exited_before_write 로 적고 불채택", async () => {
    const fake = makeFakeClaude();
    fake.setPlan(["ok", "early_exit"]);
    const r = await runBench(
      {
        bin: fake.bin,
        argsPrefix: fake.argsPrefix,
        home: fake.home,
        model: "opus",
        delayMs: 4000, // 가짜 스크립트가 부하 중에도 쓰기 전에 끝나도록 넉넉히
        timeoutMs: 10_000,
      },
      { pairs: 1, overlap: 0 },
    );
    expect(r.pairs[0]?.delayed).toMatchObject({
      code: 1,
      writeToExitMs: null,
      error: "exited_before_write",
    });
    expect(r.decision).toMatchObject({ failedPairs: 1, adopt: false });
  });
});
