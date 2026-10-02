import { describe, expect, it } from "vitest";
import { evaluateAlerts, parseDefinition, validatePayload } from "./definition";
import { addDays, computeSummary, isValidDate, mondayWeekOf } from "./summary";

const def = parseDefinition(
  JSON.stringify({
    fields: [
      { key: "n", label_ko: "수", type: "int", min: 0, max: 10, required: true },
      { key: "k", label_ko: "종류", type: "enum", options: ["a", "b"], required: true },
      { key: "t", label_ko: "글", type: "text", max: 5, required: false },
    ],
    alerts: [
      { field: "n", op: ">", value: 5, guide: "g/1" },
      { field: "n", op: "<=", value: 1, guide: "g/2" },
      { field: "n", op: "<", value: 0, guide: "g/3" },
      { field: "n", op: "!=", value: 3, guide: "g/4", message_ko: "셋이 아님" },
      { field: "k", op: "==", value: "b", guide: "g/5" },
      { field: "k", op: ">=", value: "a", guide: "g/6" },
    ],
  }),
);

describe("log type definition", () => {
  it("rejects broken or unknown shapes", () => {
    expect(parseDefinition("{nope")).toBeNull();
    expect(parseDefinition(JSON.stringify({ fields: [] }))).toBeNull();
    expect(
      parseDefinition(JSON.stringify({ fields: [{ key: "A", label_ko: "x", type: "int" }] })),
    ).toBeNull();
  });

  it("evaluates every comparison operator; strings only support == and !=", () => {
    if (!def) throw new Error("definition");
    const guides = (n: number, k: string) => evaluateAlerts(def, { n, k }).map((a) => a.guide);
    expect(guides(6, "b")).toEqual(["g/1", "g/4", "g/5"]);
    expect(guides(1, "a")).toEqual(["g/2", "g/4"]);
    expect(guides(3, "a")).toEqual([]);
    expect(evaluateAlerts(def, { n: 6, k: "a" })[0]?.message).toContain("수");
    expect(evaluateAlerts(def, { n: 1, k: "a" })[1]?.message).toBe("셋이 아님");
  });

  it("validates text length, wrong types and non-object payloads", () => {
    if (!def) throw new Error("definition");
    expect(validatePayload(def, { n: 1, k: "a", t: "123456" })).toEqual({
      ok: false,
      fields: { "payload.t": "5자까지 적을 수 있어요." },
    });
    expect(validatePayload(def, { n: "x", k: "a" })).toEqual({
      ok: false,
      fields: { "payload.n": "숫자로 적어 주세요." },
    });
    expect(validatePayload(def, null).ok).toBe(false);
    expect(validatePayload(def, { n: 1, k: "a", t: "" }).ok).toBe(true);
  });
});

describe("summary helpers", () => {
  it("date helpers", () => {
    expect(isValidDate("2020-02-29")).toBe(true);
    expect(isValidDate("2021-02-29")).toBe(false);
    expect(isValidDate("2020-2-9")).toBe(false);
    expect(addDays("2020-03-01", -1)).toBe("2020-02-29");
    expect(mondayWeekOf("2020-03-15")).toEqual({ start: "2020-03-09", end: "2020-03-15" }); // 일요일
    expect(mondayWeekOf("2020-03-16")).toEqual({ start: "2020-03-16", end: "2020-03-22" }); // 월요일
  });

  it("caps weeks at 53 and ignores logs outside the range", () => {
    if (!def) throw new Error("definition");
    const s = computeSummary({
      type: "x",
      from: "2015-01-01",
      to: "2020-01-01",
      logs: [{ id: "a", type: "x", occurredOn: "2019-12-01", payload: { n: 1, k: "a" } }],
      defs: new Map([["x", def]]),
    });
    expect(s.weeks).toHaveLength(53);
    expect(s.total).toBe(1);
    expect(s.weeks.reduce((n, w) => n + w.count, 0)).toBe(0); // 53주(약 1년) 밖이라 주차에는 안 잡힌다
  });
});
