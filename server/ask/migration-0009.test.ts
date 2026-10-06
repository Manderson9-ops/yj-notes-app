// 0009 이전 데이터(ask_feedback 의 helpful)가 ask_vote 로 옮겨지는지 확인한다. 합성 값만.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const DIR = resolve(import.meta.dirname, "../../migrations");
const files = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql"))
  .sort();
const sql = (f: string) => readFileSync(resolve(DIR, f), "utf8");

describe("migration 0009 데이터 이동", () => {
  it("helpful 행은 ask_vote 로(같은 사람은 마지막 값), 메모·원본은 그대로", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((n) => n < "0009")) db.exec(sql(f));
    db.exec(`INSERT INTO ask_question (id, asked_by, body, status, created_at, updated_at)
             VALUES (1, '엄마', '합성 질문', 'done', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
                    (2, '아빠', '합성 질문 2', 'done', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`);
    const ins = db.prepare(
      "INSERT INTO ask_feedback (question_id, by, helpful, note, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    ins.run(1, "아빠", 1, null, "2020-01-02T00:00:00.000Z");
    ins.run(1, "아빠", 0, null, "2020-01-03T00:00:00.000Z"); // 마지막 값: 0
    ins.run(1, "엄마", null, "해 봤어요", "2020-01-02T00:00:00.000Z"); // 메모만: 표 없음
    ins.run(1, "할머니", 1, "좋았어요", "2020-01-04T00:00:00.000Z"); // 표+메모
    ins.run(2, "아빠", 1, null, "2020-01-05T00:00:00.000Z");
    for (const f of files.filter((n) => n >= "0009")) db.exec(sql(f));

    const votes = db
      .prepare("SELECT question_id, by, helpful, reason, updated_at FROM ask_vote ORDER BY question_id, by")
      .all();
    expect(votes).toEqual([
      { question_id: 1, by: "아빠", helpful: 0, reason: null, updated_at: "2020-01-03T00:00:00.000Z" },
      { question_id: 1, by: "할머니", helpful: 1, reason: null, updated_at: "2020-01-04T00:00:00.000Z" },
      { question_id: 2, by: "아빠", helpful: 1, reason: null, updated_at: "2020-01-05T00:00:00.000Z" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ask_feedback").get()).toEqual({ n: 5 });
    expect(
      db.prepare("SELECT reask_count, reask_reason, reask_by, reask_at FROM ask_question WHERE id = 1").get(),
    ).toEqual({ reask_count: 0, reask_reason: null, reask_by: null, reask_at: null });
  });

  it("ask_vote 제약: 👍 에 이유 불가, 같은 사람 두 행 불가", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files) db.exec(sql(f));
    db.exec(`INSERT INTO ask_question (id, asked_by, body, status, created_at, updated_at)
             VALUES (1, '엄마', 'q', 'done', 't', 't')`);
    const ins = db.prepare("INSERT INTO ask_vote VALUES (?, ?, ?, ?, 't')");
    expect(() => ins.run(1, "a", 1, "이유")).toThrow();
    expect(() => ins.run(1, "a", 2, null)).toThrow();
    ins.run(1, "a", 0, "이유");
    expect(() => ins.run(1, "a", 1, null)).toThrow();
  });
});
