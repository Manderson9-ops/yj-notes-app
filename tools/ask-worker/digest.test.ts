import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDigest, writeDigest } from "./digest.ts";
import { goodAnswer } from "./fixtures.ts";
import { hist } from "./hist-fixture.ts";
import { parseHistory, parseReask } from "./inject.ts";

const NOW = Date.parse("2020-03-31T00:00:00Z");

describe("buildDigest", () => {
  it("최근 30일 안의 👍·👎·메모 수와 질문 번호만(본문 없음)", () => {
    const items = [
      hist({
        id: 5,
        body: "합성 비밀 본문",
        votes: [
          { by: "엄마", helpful: true, reason: null, updatedAt: "2020-03-20T00:00:00Z" },
          { by: "아빠", helpful: false, reason: "합성 이유", updatedAt: "2020-03-21T00:00:00Z" },
          { by: "할머니", helpful: false, reason: null, updatedAt: "2020-01-01T00:00:00Z" }, // 창 밖
        ],
        notes: [{ by: "엄마", note: "합성 메모 본문", createdAt: "2020-03-22T00:00:00Z" }],
      }),
      hist({
        id: 3,
        votes: [{ by: "엄마", helpful: false, reason: null, updatedAt: "2020-03-30T00:00:00Z" }],
        notes: [{ by: "엄마", note: "오래된 메모", createdAt: "2019-12-01T00:00:00Z" }],
      }),
    ];
    const d = buildDigest(items, NOW);
    expect(d).toEqual({
      updatedAt: "2020-03-31T00:00:00.000Z",
      windowDays: 30,
      up: 1,
      down: 2,
      notes: 1,
      downQuestionIds: [3, 5],
      noteQuestionIds: [5],
    });
    const json = JSON.stringify(d);
    expect(json).not.toContain("합성");
    expect(json).not.toContain("엄마");
  });
  it("빈 목록·읽을 수 없는 시각", () => {
    expect(buildDigest([], NOW)).toMatchObject({ up: 0, down: 0, notes: 0, downQuestionIds: [] });
    const bad = hist({ votes: [{ by: "a", helpful: true, reason: null, updatedAt: "x" }] });
    expect(buildDigest([bad], NOW).up).toBe(0);
  });
  it("writeDigest: 폴더를 만들고 JSON 으로 쓴다(임시 파일 남기지 않음)", () => {
    const dir = mkdtempSync(join(tmpdir(), "yj-digest-"));
    try {
      const p = join(dir, "sub", "feedback-digest.json");
      writeDigest(p, buildDigest([], NOW));
      expect((JSON.parse(readFileSync(p, "utf8")) as { windowDays: number }).windowDays).toBe(30);
      expect(() => readFileSync(`${p}.tmp`)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("주입 파일 형식(--history / --reask)", () => {
  it("--history: 배열 또는 {items}", () => {
    const item = hist({ id: 2 });
    expect(parseHistory(JSON.stringify([item]))).toEqual([item]);
    expect(parseHistory(JSON.stringify({ items: [item] }))).toEqual([item]);
    expect(() => parseHistory(JSON.stringify([{ id: 1 }]))).toThrow();
  });
  it("--reask: 한 덩어리는 모든 문항, 맵은 문항 id 별", () => {
    const one = { reason: "더 자세히 알고 싶어요", previousAnswer: goodAnswer() };
    const all = parseReask(JSON.stringify(one));
    expect(all("g01")?.reason).toBe("더 자세히 알고 싶어요");
    expect(all("g02")?.count).toBe(1); // 기본값
    expect(all("g02")?.by).toBe("가족");
    const map = parseReask(JSON.stringify({ g01: { ...one, count: 2, by: "아빠" } }));
    expect(map("g01")).toMatchObject({ count: 2, by: "아빠" });
    expect(map("g02")).toBeUndefined();
    expect(() => parseReask(JSON.stringify({ reason: "x" }))).toThrow();
  });
});
