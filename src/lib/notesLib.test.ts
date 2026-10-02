import { describe, expect, it } from "vitest";
import {
  daysSince,
  formatDateKo,
  formatShortKo,
  minusMonths,
  monthLabelKo,
  timeOf,
} from "./dateFormat";
import { segmentsByRanges, segmentsByTerm } from "./highlight";
import { buildHit } from "./noteHit";

describe("dateFormat", () => {
  it("formats Korean dates with weekday", () => {
    expect(formatDateKo("2020-03-02")).toBe("2020년 3월 2일 (월)");
    expect(formatShortKo("2020-03-08")).toBe("3월 8일 (일)");
    expect(monthLabelKo("2020-03-08")).toBe("2020년 3월");
  });
  it("minusMonths clamps to month end and crosses years", () => {
    expect(minusMonths("2020-03-31", 1)).toBe("2020-02-29");
    expect(minusMonths("2020-02-10", 3)).toBe("2019-11-10");
  });
  it("timeOf / daysSince", () => {
    expect(timeOf("2020-03-02 16:10")).toBe("16:10");
    expect(timeOf("x")).toBe("");
    expect(daysSince("2020-01-01T00:00:00Z", Date.parse("2020-01-16T12:00:00Z"))).toBe(15);
    expect(daysSince("bad", 0)).toBe(0);
  });
});

describe("highlight", () => {
  it("splits by ranges and by term (case-insensitive)", () => {
    expect(segmentsByRanges("abcdef", [[1, 3]])).toEqual([
      { text: "a", hit: false },
      { text: "bc", hit: true },
      { text: "def", hit: false },
    ]);
    expect(segmentsByTerm("Foo foo", "foo").filter((s) => s.hit)).toHaveLength(2);
    expect(segmentsByTerm("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(segmentsByRanges("abc", [[5, 9]])).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("buildHit", () => {
  it("returns an excerpt with ranges; null when absent", () => {
    const text = `${"가".repeat(60)}목표${"나".repeat(60)}`;
    const hit = buildHit(text, "목표", "body");
    expect(hit?.cutStart).toBe(true);
    expect(hit?.cutEnd).toBe(true);
    const [s, e] = hit?.ranges[0] ?? [0, 0];
    expect(hit?.text.slice(s, e)).toBe("목표");
    expect(buildHit("abc", "zzz", "body")).toBeNull();
    expect(buildHit("abc", "", "body")).toBeNull();
  });
  it("does not cut an emoji in half", () => {
    const text = `${"가".repeat(23)}😊목표`;
    const hit = buildHit(text, "목표", "comment");
    expect(hit?.text.includes("\ud83d") && !hit.text.includes("😊")).toBe(false);
  });
});
