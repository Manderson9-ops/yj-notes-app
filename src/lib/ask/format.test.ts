import { describe, expect, it } from "vitest";
import { oldAnswerLine, reaskByLine, reaskLeftLine, subjectParticle } from "./format";

describe("주격 조사 가/이", () => {
  it("받침 없으면 가, 있으면 이", () => {
    for (const n of ["엄마", "아빠", "할머니", "이모"]) expect(subjectParticle(n), n).toBe("가");
    for (const n of ["동생", "영진", "삼촌"]) expect(subjectParticle(n), n).toBe("이");
    expect(subjectParticle("A")).toBe("가");
    expect(subjectParticle("")).toBe("가");
  });
  it("다시 요청 줄", () => {
    expect(reaskByLine("아빠", "이미 해 봤어요")).toBe("아빠가 다시 요청했어요: 이미 해 봤어요");
    expect(reaskByLine("삼촌", "너무 일반적이에요")).toBe(
      "삼촌이 다시 요청했어요: 너무 일반적이에요",
    );
    expect(reaskByLine("", "x")).toBe("가족이 다시 요청했어요: x");
  });
  it("남은 횟수·이전 답 줄", () => {
    expect(reaskLeftLine(2)).toBe("다시 답변을 2번 더 받을 수 있어요.");
    expect(oldAnswerLine(1, "2020-01-15T03:00:00.000Z")).toBe("1번째 답 · 1월 15일");
    expect(oldAnswerLine(2, "2020-01-15T20:00:00.000Z")).toBe("2번째 답 · 1월 16일"); // 한국 시간
  });
});
