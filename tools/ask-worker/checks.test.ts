import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { answerSchema } from "./answer-schema.ts";
import { checkAnswer, findForbidden } from "./checks.ts";
import { goodAnswer, PACK } from "./fixtures.ts";
import { LEVEL_TITLES } from "./levels.ts";

describe("findForbidden", () => {
  it("판정 어휘를 잡는다", () => {
    expect(findForbidden("정상 범위예요")).toContain("정상");
    expect(findForbidden("비정상")).toContain("비정상");
    expect(findForbidden("이상해요")).toContain("이상");
    expect(findForbidden("발달 지연")).toContain("지연");
    expect(findForbidden("자폐 같아요")).toContain("자폐");
    expect(findForbidden("문제아")).toContain("문제아");
    expect(findForbidden("진단명이 있어요")).toContain("진단");
  });
  it("기간·횟수 뒤의 이상, 부정 진단, 장애물은 허용한다", () => {
    expect(findForbidden("2주 이상 이어지면")).toEqual([]);
    expect(findForbidden("38도 이상이면")).toEqual([]);
    expect(findForbidden("진단하지 않아요")).toEqual([]);
    expect(findForbidden("장애물 놀이")).toEqual([]);
  });
});

describe("checkAnswer", () => {
  it("정상 답은 통과하고 levelTitle 을 정규 문구로 고정한다", () => {
    const r = checkAnswer(goodAnswer({ levelTitle: "내 맘대로" }), PACK, false);
    expect(r.ok).toBe(true);
    expect(r.answer?.levelTitle).toBe(LEVEL_TITLES[3]);
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

describe("answer.schema.json 과 zod 스키마 일치", () => {
  const file = JSON.parse(
    readFileSync(new URL("./answer.schema.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  const generated = z.toJSONSchema(answerSchema) as Record<string, unknown>;

  // 비교 대상 제약만 뽑는다(키 순서·title·$schema·정규식 표기 제외).
  const norm = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(norm);
    if (!n || typeof n !== "object") return n;
    const o = n as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of [
      "type",
      "enum",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
      "maxLength",
      "additionalProperties",
    ]) {
      if (k in o) out[k] = o[k];
    }
    if (Array.isArray(o.required)) out.required = [...(o.required as string[])].sort();
    if (o.properties && typeof o.properties === "object") {
      out.properties = Object.fromEntries(
        Object.entries(o.properties as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, norm(v)]),
      );
    }
    if (o.items) out.items = norm(o.items);
    return out;
  };

  it("제약이 같다", () => {
    expect(norm(file)).toEqual(norm(generated));
  });
  it("draft 2020-12 선언", () => {
    expect(file.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(file.additionalProperties).toBe(false);
  });
});
