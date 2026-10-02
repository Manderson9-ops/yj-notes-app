import { describe, expect, it } from "vitest";
import { formatValue, optionLabel } from "./format";
import type { LogField } from "./schemas";

const hand: LogField = {
  key: "hand_state",
  label_ko: "손 상태",
  type: "enum",
  options: ["거스러미", "정상"],
  labels: { 정상: "이상 없음" },
  required: true,
};
const plain: LogField = { key: "k", label_ko: "k", type: "enum", options: ["가"], required: true };

describe("optionLabel / formatValue", () => {
  it("shows the label for a stored value that has one, the value itself otherwise", () => {
    expect(optionLabel(hand, "정상")).toBe("이상 없음");
    expect(optionLabel(hand, "거스러미")).toBe("거스러미");
    expect(optionLabel(plain, "가")).toBe("가");
    expect(formatValue(hand, "정상")).toBe("이상 없음");
    expect(formatValue(hand, undefined)).toBe("-");
  });
  it("does not touch int fields", () => {
    const n: LogField = {
      key: "n",
      label_ko: "n",
      type: "int",
      min: 0,
      max: 9,
      unit: "분",
      required: true,
    };
    expect(formatValue(n, 5)).toBe("5분");
  });
});
