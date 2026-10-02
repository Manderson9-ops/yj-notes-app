import { describe, expect, it } from "vitest";
import { fmtTick, linearScale, monthTicks, niceTicks, refAt, refSeries } from "./chart";

const REF = [
  { ageMonth: 0, p3: 1, p50: 2, p97: 3 },
  { ageMonth: 10, p3: 11, p50: 12, p97: 13 },
  { ageMonth: 20, p3: null, p50: 22, p97: 23 },
];

describe("niceTicks", () => {
  it("covers the range with round steps", () => {
    const t = niceTicks(58.2, 83.4, 7);
    expect(t[0]).toBeLessThanOrEqual(58.2);
    expect(t.at(-1)).toBeGreaterThanOrEqual(83.4);
    expect(t.length).toBeLessThanOrEqual(8);
    expect((t[1] ?? 0) - (t[0] ?? 0)).toBe(5);
  });
  it("handles a flat range", () => {
    const t = niceTicks(10, 10);
    expect(t.length).toBeGreaterThan(1);
    expect(t[0]).toBeLessThan(10);
  });
  it("keeps decimals clean", () => {
    expect(niceTicks(5.1, 9.4).every((v) => v === Math.round(v * 100) / 100)).toBe(true);
  });
});

describe("monthTicks", () => {
  it("never returns more than 7 ticks", () => {
    for (const [a, b] of [
      [0, 6],
      [2, 20],
      [0, 60],
      [3, 200],
    ] as const) {
      const t = monthTicks(a, b);
      expect(t.length).toBeLessThanOrEqual(7);
      expect(t.every((v) => v >= a && v <= b)).toBe(true);
    }
  });
});

describe("reference curves", () => {
  it("interpolates between rows and returns null outside", () => {
    expect(refAt(REF, "p50", 5)).toBe(7);
    expect(refAt(REF, "p50", 10)).toBe(12);
    expect(refAt(REF, "p50", 25)).toBeNull();
    expect(refAt(REF, "p3", 15)).toBeNull();
  });
  it("builds a series with interpolated edges", () => {
    expect(refSeries(REF, "p97", 5, 15)).toEqual([
      { age: 5, value: 8 },
      { age: 10, value: 13 },
      { age: 15, value: 18 },
    ]);
  });
});

describe("scales", () => {
  it("maps linearly, also inverted", () => {
    expect(linearScale(0, 10, 0, 100)(5)).toBe(50);
    expect(linearScale(0, 10, 100, 0)(2)).toBe(80);
    expect(fmtTick(62.5000001)).toBe("62.5");
  });
});
