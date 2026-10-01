import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(resolve(import.meta.dirname, "../..", rel), "utf8");

const TABLES = [
  "ingest_run",
  "note_day",
  "note_item",
  "note_comment",
  "milestone",
  "observation",
  "growth_ref",
  "checkup",
  "measurement",
  "log_type",
  "family_log",
  "report_doc",
  "auth_attempt",
  "app_setting",
];

interface Field {
  key: string;
  label_ko: string;
  type: "enum" | "int" | "text";
  options?: string[];
  min?: number;
  max?: number;
  required: boolean;
}
interface LogSchema {
  fields: Field[];
  alerts: { field: string; op: string; value: string | number; guide: string }[];
}

let db: DatabaseSync;

const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(read("migrations/0001_init.sql"));
  db.exec(read("migrations/0002_seed_settings.sql"));
  db.exec(read("fixtures/seed/fixtures.sql"));
});

describe("D1 schema", () => {
  it("모든 테이블이 있다", () => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const names = rows.map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it("CHECK 제약이 잘못된 값을 거부한다", () => {
    expect(() => {
      db.exec(
        "INSERT INTO ingest_run (started_at, source_commit, status, counts_json, verify_json) VALUES ('2020-01-01','x','bad','{}','{}')",
      );
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec(
        "INSERT INTO note_item (report_id, date, author_role, direction, posted_at, body) VALUES (1,'2020-03-02','교사','sideways','t','b')",
      );
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec(
        "INSERT INTO observation (evidence_id, date, age_months, section, confidence, subject_near, snippet) VALUES ('FX-12M-01','2020-03-02',1,'s','LOW',0,'x')",
      );
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec(
        "INSERT INTO measurement (measured_on, measure, value, read_status) VALUES ('2020-04-10','shoe_size',1,'CONFIRMED')",
      );
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec(
        "INSERT INTO measurement (measured_on, measure, value, read_status) VALUES ('2020-04-10','height_cm',1,'MAYBE')",
      );
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec(
        "INSERT INTO note_comment (id, report_id, who, posted_at, body) VALUES (999,9000001,'stranger','t','b')",
      );
    }).toThrow(/CHECK/);
    expect(() => {
      db.exec(
        "INSERT INTO report_doc (slug,title,kind,r2_key,generated_at,source_commit,verify_ok,sha256) VALUES ('s','t','pdf','k','t','c',1,'h')",
      );
    }).toThrow(/CHECK/);
  });

  it("observation → milestone 외래키가 강제된다", () => {
    expect(() => {
      db.exec(
        "INSERT INTO observation (evidence_id, date, age_months, section, confidence, subject_near, snippet) VALUES ('NOPE','2020-03-02',1,'s','HIGH',0,'x')",
      );
    }).toThrow(/FOREIGN KEY/);
  });

  it("모든 observation.snippet 은 같은 날짜 note_item.body 의 부분 문자열이다 (ingest I3)", () => {
    const rows = db.prepare("SELECT date, snippet FROM observation").all() as {
      date: string;
      snippet: string;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const stmt = db.prepare("SELECT body FROM note_item WHERE date = ?");
    for (const { date, snippet } of rows) {
      const bodies = (stmt.all(date) as { body: string }[]).map((b) => b.body);
      expect(bodies.some((b) => b.includes(snippet))).toBe(true);
    }
  });

  it("log_type.schema_json 은 docs/03 §3 필드를 담는다", () => {
    const expected: Record<string, string[]> = {
      meal: [
        "announced",
        "came",
        "tantrum_min",
        "aggression",
        "amount",
        "snack_before",
        "sick",
        "phone",
      ],
      cry: ["trigger", "minutes", "soothed_by", "place"],
      skin_pick: ["when", "mood", "hand_state", "response"],
      bandage_step: ["step", "result", "helper"],
    };
    for (const [code, keys] of Object.entries(expected)) {
      const row = db.prepare("SELECT schema_json FROM log_type WHERE code = ?").get(code) as {
        schema_json: string;
      };
      const schema = JSON.parse(row.schema_json) as LogSchema;
      expect(schema.fields.map((f) => f.key)).toEqual(keys);
      for (const f of schema.fields) {
        expect(f.label_ko.length).toBeGreaterThan(0);
        if (f.type === "enum") expect(f.options?.length).toBeGreaterThan(0);
        if (f.type === "int") expect(f.min).toBeLessThanOrEqual(f.max ?? NaN);
      }
      expect(Array.isArray(schema.alerts)).toBe(true);
    }
    const meal = JSON.parse(
      (
        db.prepare("SELECT schema_json FROM log_type WHERE code='meal'").get() as {
          schema_json: string;
        }
      ).schema_json,
    ) as LogSchema;
    expect(meal.alerts).toContainEqual({
      field: "tantrum_min",
      op: ">=",
      value: 25,
      guide: "guide/05#3-1",
    });
    expect(meal.alerts.some((a) => a.field === "aggression" && a.value === "사람 때림")).toBe(true);
  });

  it("family_log payload 가 schema_json 에 맞는다", () => {
    const logs = db.prepare("SELECT type, payload FROM family_log").all() as {
      type: string;
      payload: string;
    }[];
    for (const l of logs) {
      const schema = JSON.parse(
        (
          db.prepare("SELECT schema_json FROM log_type WHERE code = ?").get(l.type) as {
            schema_json: string;
          }
        ).schema_json,
      ) as LogSchema;
      const p = JSON.parse(l.payload) as Record<string, string | number>;
      for (const f of schema.fields) {
        const v = p[f.key];
        if (f.type === "enum") expect(f.options).toContain(v);
        if (f.type === "int") {
          expect(typeof v).toBe("number");
          expect(v as number).toBeGreaterThanOrEqual(f.min ?? -Infinity);
          expect(v as number).toBeLessThanOrEqual(f.max ?? Infinity);
        }
      }
    }
  });

  it("시드·fixture 건수", () => {
    expect(count("SELECT count(*) n FROM note_day")).toBe(30);
    expect(count("SELECT count(*) n FROM note_day WHERE n_reports = 2")).toBe(1);
    expect(count("SELECT count(*) n FROM note_day WHERE n_comments = 0")).toBe(1);
    expect(count("SELECT count(*) n FROM note_item WHERE body LIKE '%😊%'")).toBeGreaterThan(0);
    expect(count("SELECT count(*) n FROM milestone")).toBe(10);
    expect(count("SELECT count(*) n FROM growth_ref")).toBe(26);
    expect(count("SELECT count(*) n FROM checkup")).toBe(1);
    expect(count("SELECT count(*) n FROM measurement")).toBe(4);
    expect(count("SELECT count(*) n FROM measurement WHERE read_status='UNCERTAIN'")).toBe(1);
    expect(count("SELECT count(*) n FROM measurement WHERE condition_note='옷 입고 측정'")).toBe(1);
    expect(count("SELECT count(*) n FROM family_log")).toBe(20);
    expect(count("SELECT count(*) n FROM report_doc")).toBe(2);
    expect(count("SELECT count(*) n FROM ingest_run")).toBe(1);
    expect(count("SELECT count(*) n FROM log_type")).toBe(4);
    const epoch = db.prepare("SELECT value FROM app_setting WHERE key='session_epoch'").get() as {
      value: string;
    };
    expect(epoch.value).toBe("1");
  });

  it("note_day 집계가 항목·댓글 수와 일치한다 (P3)", () => {
    const bad = count(`SELECT count(*) n FROM note_day d WHERE
      d.n_reports <> (SELECT count(*) FROM note_item i WHERE i.date = d.date) OR
      d.n_comments <> (SELECT count(*) FROM note_comment c JOIN note_item i ON i.report_id = c.report_id WHERE i.date = d.date)`);
    expect(bad).toBe(0);
  });

  it("fixture 날짜는 모두 2020년이다", () => {
    expect(count("SELECT count(*) n FROM note_day WHERE date NOT LIKE '2020-%'")).toBe(0);
    expect(count("SELECT count(*) n FROM family_log WHERE occurred_on NOT LIKE '2020-%'")).toBe(0);
  });
});
