import { describe, expect, it } from "vitest";
import {
  daysSince,
  formatYmdKo,
  seoulDateOf,
  formatDateKo,
  formatShortKo,
  minusMonths,
  monthEnd,
  monthLabelKo,
  monthLabelOf,
  monthsDesc,
  timeKo,
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
  it("monthEnd / monthsDesc / monthLabelOf", () => {
    expect(monthEnd("2020-02")).toBe("2020-02-29");
    expect(monthEnd("2021-12")).toBe("2021-12-31");
    expect(monthsDesc("2020-03-05", "2020-05-01")).toEqual(["2020-05", "2020-04", "2020-03"]);
    expect(monthsDesc("2019-11-30", "2020-02-01")).toEqual([
      "2020-02",
      "2020-01",
      "2019-12",
      "2019-11",
    ]);
    expect(monthsDesc("2020-03-01", "2020-03-31")).toEqual(["2020-03"]);
    expect(monthLabelOf("2020-03")).toBe("2020년 3월");
  });
  it("timeKo uses a 12-hour clock with 오전/오후", () => {
    expect(timeKo("2020-03-02 16:10")).toBe("오후 4:10");
    expect(timeKo("2020-03-02 00:05")).toBe("오전 12:05");
    expect(timeKo("2020-03-02 12:00")).toBe("오후 12:00");
    expect(timeKo("2020-03-02 09:49")).toBe("오전 9:49");
    expect(timeKo("x")).toBe("");
  });
  it("timeOf / daysSince", () => {
    expect(timeOf("2020-03-02 16:10")).toBe("16:10");
    expect(timeOf("x")).toBe("");
    expect(daysSince("2020-01-01T00:00:00Z", Date.parse("2020-01-16T12:00:00Z"))).toBe(15);
    expect(daysSince("bad", 0)).toBe(0);
    // 한국 날짜 기준: UTC 23:50 은 한국 다음 날 08:50 — 같은 날 아침이면 "오늘"(0일)
    expect(daysSince("2020-03-01T23:50:00Z", Date.parse("2020-03-02T00:30:00Z"))).toBe(0);
    // 한국 어제 밤 기록은 오늘 아침 기준 1일 전
    expect(daysSince("2020-03-01T13:00:00Z", Date.parse("2020-03-02T00:30:00Z"))).toBe(1);
  });

  it("seoulDateOf / formatYmdKo", () => {
    expect(seoulDateOf("2020-03-01T23:50:00Z")).toBe("2020-03-02");
    expect(seoulDateOf("2020-03-01T14:59:59Z")).toBe("2020-03-01");
    expect(seoulDateOf("bad")).toBe("");
    expect(formatYmdKo("2020-03-02")).toBe("2020년 3월 2일");
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
