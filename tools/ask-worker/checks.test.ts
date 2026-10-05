import { describe, expect, it } from "vitest";
import { hasForbiddenWord } from "../../shared/ask-forbidden.ts";
import { checkAnswer } from "./checks.ts";
import { goodAnswer, PACK } from "./fixtures.ts";
import { levelTitle } from "./levels.ts";

describe("공용 금지어(shared/ask-forbidden)", () => {
  it("판정 어휘를 잡는다", () => {
    for (const w of [
      "정상 범위예요",
      "비정상",
      "이상해요",
      "발달 지연",
      "자폐 같아요",
      "문제아",
      "진단명이 있어요",
    ]) {
      expect(hasForbiddenWord(w), w).toBe(true);
    }
  });
  it("기간·횟수 뒤의 이상, 부정 진단은 허용한다", () => {
    for (const w of ["2주 이상 이어지면", "38도 이상이면", "진단하지 않아요"]) {
      expect(hasForbiddenWord(w), w).toBe(false);
    }
  });
});

describe("checkAnswer", () => {
  it("정상 답은 통과하고 levelTitle 을 정규 문구로 고정한다", () => {
    const r = checkAnswer(goodAnswer({ levelTitle: "내 맘대로" }), PACK, false);
    expect(r.ok).toBe(true);
    expect(r.answer?.levelTitle).toBe(levelTitle(4));
  });
  it("스키마 위반(추가 키, 길이, 배열 하한)", () => {
    expect(checkAnswer({ ...goodAnswer(), extra: 1 }, PACK, false).ok).toBe(false);
    expect(checkAnswer(goodAnswer({ summary: "가".repeat(601) }), PACK, false).ok).toBe(false);
    expect(checkAnswer(goodAnswer({ tryNow: [{ action: "하나" }] }), PACK, false).ok).toBe(false);
    expect(checkAnswer(goodAnswer({ level: 11 }), PACK, false).ok).toBe(false);
    expect(checkAnswer("x", PACK, false).answer).toBeNull();
  });
  it("redFlag 면 level 10 이어야 한다", () => {
    const bad = checkAnswer(goodAnswer({ level: 5 }), PACK, true);
    expect(bad.ok).toBe(false);
    expect(bad.issues.join()).toContain("level 10");
    expect(checkAnswer(goodAnswer({ level: 10 }), PACK, true).ok).toBe(true);
  });
  it("금지어를 어느 필드에서든 잡는다", () => {
    const r = checkAnswer(goodAnswer({ limits: "정상 범위로 보여요" }), PACK, false);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toContain("금지어");
  });
  it("묶음에 없는 ref·날짜를 잡는다", () => {
    const r = checkAnswer(
      goodAnswer({
        evidence: [{ ref: "FAKE-1", point: "가짜" }],
        fromRecords: [{ date: "2020-12-31", what: "없는 기록", source: "알림장" }],
      }),
      PACK,
      false,
    );
    expect(r.issues.some((i) => i.includes("ref"))).toBe(true);
    expect(r.issues.some((i) => i.includes("날짜"))).toBe(true);
  });
  it("fromRecords 는 비어도 된다", () => {
    expect(checkAnswer(goodAnswer({ fromRecords: [] }), PACK, false).ok).toBe(true);
  });
});
