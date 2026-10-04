// /api/notes, /api/notes/:date, /api/overview 통합 테스트 (가짜 D1 + 합성 fixture 만 사용).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "../test-utils/harness";
import { cookieFrom, createHarness, TEST_PIN } from "../test-utils/harness";
import { likePattern } from "./notes";
import {
  noteDaySchema,
  notesListSchema,
  overviewSchema,
  type NoteDay,
  type NotesList,
} from "../../src/lib/notesSchemas";

const SEED = resolve(import.meta.dirname, "../../fixtures/seed");
const seedFile = (h: Harness, name: string) => {
  h.fake.sqlite.exec(readFileSync(resolve(SEED, name), "utf8"));
};

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = await createHarness();
  cookie = cookieFrom(await h.login(TEST_PIN));
});

const get = (path: string) => h.authedGet(path, cookie);
const list = async (qs = ""): Promise<NotesList> => {
  const res = await get(`/api/notes${qs}`);
  expect(res.status).toBe(200);
  return notesListSchema.parse(await res.json());
};
const count = (sql: string): number => (h.fake.sqlite.prepare(sql).get() as { c: number }).c;

describe("seeded fixtures (30 days + edge cases)", () => {
  beforeEach(() => {
    seedFile(h, "fixtures.sql");
    seedFile(h, "notes-edge.sql");
  });

  it("fixtures meet the T-20 shape: 34 days, 40 comments", () => {
    expect(count("SELECT COUNT(*) c FROM note_day")).toBe(34);
    expect(count("SELECT COUNT(*) c FROM note_comment")).toBe(40);
  });

  it("lists newest first with a cursor that pages through every day exactly once", async () => {
    const first = await list("?limit=20");
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.date).toBe("2020-04-04");
    expect(first.nextCursor).toBe(first.items[19]?.date);
    const second = await list(`?limit=20&cursor=${first.nextCursor ?? ""}`);
    expect(second.items).toHaveLength(14);
    expect(second.nextCursor).toBeNull();
    const dates = [...first.items, ...second.items].map((i) => i.date);
    expect(new Set(dates).size).toBe(34);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("list items carry the day numbers (reports, comments, age)", async () => {
    const all = await list("?limit=50");
    const day = all.items.find((i) => i.date === "2020-03-11");
    expect(day).toMatchObject({ nReports: 2, nComments: 1, ageMonths: 1, class: "합성반" });
  });

  it("filters by from/to and class", async () => {
    const r = await list("?from=2020-03-10&to=2020-03-12");
    expect(r.items.map((i) => i.date)).toEqual(["2020-03-12", "2020-03-11", "2020-03-10"]);
    expect((await list("?class=없는반")).items).toEqual([]);
    expect((await list("?class=합성반&limit=1")).items).toHaveLength(1);
  });

  it("searches bodies with a highlighted excerpt", async () => {
    const r = await list(`?q=${encodeURIComponent("그림책")}`);
    expect(r.items.map((i) => i.date)).toEqual(["2020-03-03"]);
    const hit = r.items[0]?.hit;
    expect(hit?.source).toBe("body");
    const [s, e] = hit?.ranges[0] ?? [0, 0];
    expect(hit?.text.slice(s, e)).toBe("그림책");
  });

  it("searches comments too and says so", async () => {
    const r = await list(`?q=${encodeURIComponent("긴 글 잘")}`);
    expect(r.items.map((i) => i.date)).toEqual(["2020-04-02"]);
    expect(r.items[0]?.hit?.source).toBe("comment");
  });

  it("long bodies give a short excerpt, not the whole text", async () => {
    const r = await list(`?q=${encodeURIComponent("무너뜨리기")}`);
    const hit = r.items.find((i) => i.date === "2020-04-02")?.hit;
    expect(hit?.text.length).toBeLessThan(100);
    expect(hit?.cutEnd).toBe(true);
  });

  it("treats % _ \\ as plain characters (escaped LIKE)", async () => {
    for (const q of ["%", "_", "\\", "100%", "a_b", "C:\\놀이"]) {
      const r = await list(`?q=${encodeURIComponent(q)}`);
      expect(
        r.items.map((i) => i.date),
        q,
      ).toEqual(["2020-04-03"]);
    }
    expect(likePattern("a%b_c\\")).toBe("%a\\%b\\_c\\\\%");
  });

  it("an SQL-looking query is just text and finds nothing", async () => {
    const r = await list(`?q=${encodeURIComponent("' OR 1=1 --")}`);
    expect(r.items).toEqual([]);
    expect(count("SELECT COUNT(*) c FROM note_day")).toBe(34);
  });

  it("empty result is 200 with no items and no cursor", async () => {
    const r = await list(`?q=${encodeURIComponent("없는말없는말")}`);
    expect(r).toEqual({ items: [], nextCursor: null });
  });

  it("search + period + cursor combine", async () => {
    const r = await list(`?q=${encodeURIComponent("친구A")}&to=2020-03-20`);
    expect(r.items.every((i) => i.date <= "2020-03-20" && i.hit !== undefined)).toBe(true);
    expect(r.items.length).toBeGreaterThan(1);
  });

  it.each([
    ["q too long", `?q=${"가".repeat(41)}`],
    ["bad date", "?from=2020-3-1"],
    ["bad cursor", "?cursor=zzz"],
    ["limit too big", "?limit=51"],
    ["limit zero", "?limit=0"],
  ])("rejects %s with 400", async (_n, qs) => {
    const res = await get(`/api/notes${qs}`);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("bad_request");
  });

  it("detail: two reports in one day, with comments by role", async () => {
    const res = await get("/api/notes/2020-03-11");
    const day: NoteDay = noteDaySchema.parse(await res.json());
    expect(day.items).toHaveLength(2);
    expect(day.items[0]?.comments).toHaveLength(1);
    expect(day.items[0]?.comments[0]?.who).toBe("parent");
    expect(day.items[1]?.comments).toEqual([]);
    expect(day).toMatchObject({ ageMonths: 1, prev: "2020-03-10", next: "2020-03-12" });
  });

  it("detail: teacher + parent comments, empty body, to_center direction", async () => {
    const t = noteDaySchema.parse(await (await get("/api/notes/2020-04-03")).json());
    expect(t.items[0]?.comments.map((c) => c.who)).toEqual(["teacher", "parent"]);
    const empty = noteDaySchema.parse(await (await get("/api/notes/2020-04-01")).json());
    expect(empty.items[0]?.body).toBe("");
    const two = noteDaySchema.parse(await (await get("/api/notes/2020-04-04")).json());
    expect(two.items.map((i) => i.direction)).toEqual(["to_center", "to_home"]);
    expect(two.items.map((i) => i.authorRole)).toEqual(["엄마", "교사"]);
  });

  it("detail: first and last day have a null neighbour", async () => {
    const first = noteDaySchema.parse(await (await get("/api/notes/2020-03-02")).json());
    expect(first.prev).toBeNull();
    const last = noteDaySchema.parse(await (await get("/api/notes/2020-04-04")).json());
    expect(last.next).toBeNull();
  });

  it("detail: unknown day is 404, malformed date is 400", async () => {
    expect((await get("/api/notes/2019-01-01")).status).toBe(404);
    expect((await get("/api/notes/not-a-date")).status).toBe(400);
  });

  it("overview counts come from queries", async () => {
    const res = await get("/api/overview");
    const o = overviewSchema.parse(await res.json());
    expect(o.noteDays).toBe(count("SELECT COUNT(*) c FROM note_day"));
    expect(o.reports).toBe(count("SELECT SUM(n_reports) c FROM note_day"));
    expect(o.comments).toBe(40);
    expect(o.range).toEqual({ from: "2020-03-02", to: "2020-04-04" });
    expect(o.lastIngest?.status).toBe("ok");
    expect(o.recentNotes.map((n) => n.date)).toEqual(["2020-04-04", "2020-04-03", "2020-04-02"]);
    expect(o.recentLogs).toHaveLength(5);
    expect(o.milestones.observed + o.milestones.unobserved).toBe(
      count("SELECT COUNT(*) c FROM milestone"),
    );
  });
});

describe("empty database", () => {
  it("overview is zeros and empty arrays, not an error", async () => {
    const res = await get("/api/overview");
    expect(res.status).toBe(200);
    const o = overviewSchema.parse(await res.json());
    expect(o).toEqual({
      noteDays: 0,
      reports: 0,
      comments: 0,
      range: null,
      ingestState: "idle",
      security: { lastGlobalLockAt: null },
      lastIngest: null,
      milestones: { observed: 0, unobserved: 0 },
      recentNotes: [],
      recentLogs: [],
    });
  });

  it("R1-3: overview exposes last_global_lock_at to authenticated users only", async () => {
    h.fake.sqlite.exec(
      "INSERT INTO app_setting (key, value) VALUES ('last_global_lock_at', '2030-01-01T00:00:29.000Z')",
    );
    const o = overviewSchema.parse(await (await get("/api/overview")).json());
    expect(o.security).toEqual({ lastGlobalLockAt: "2030-01-01T00:00:29.000Z" });
    expect((await h.handle(new Request("https://app.example.test/api/overview"))).status).toBe(401);
  });

  it("R1-6: overview reports ingestState from the latest run", async () => {
    const state = async () =>
      overviewSchema.parse(await (await get("/api/overview")).json()).ingestState;
    const ins = h.fake.sqlite.prepare(
      "INSERT INTO ingest_run (id, started_at, finished_at, source_commit, status, counts_json, verify_json) VALUES (?, ?, NULL, 'c', ?, '{}', '{}')",
    );
    expect(await state()).toBe("idle");
    ins.run(1, "2030-01-01T00:00:00Z", "ok");
    expect(await state()).toBe("idle");
    ins.run(2, "2030-01-01T00:00:10Z", "failed");
    expect(await state()).toBe("failed");
    ins.run(3, "2030-01-01T00:00:20Z", "running");
    expect(await state()).toBe("running");
    ins.run(4, "2030-01-01T00:00:30Z", "ok");
    expect(await state()).toBe("idle");
  });

  it("notes list is empty, not an error", async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
  });

  it("deleted family logs are not in recentLogs", async () => {
    const insert = h.fake.sqlite.prepare(
      `INSERT INTO family_log (id, type, occurred_on, recorder, payload, note, created_at, updated_at, deleted_at, device_id)
       VALUES (?, 'cry', ?, '엄마', '{}', NULL, '2020-04-01T00:00:00Z', '2020-04-01T00:00:00Z', ?, 'd')`,
    );
    insert.run("a", "2020-04-01", null);
    insert.run("b", "2020-04-02", "2020-04-03T00:00:00Z");
    const o = overviewSchema.parse(await (await get("/api/overview")).json());
    expect(o.recentLogs.map((l) => l.id)).toEqual(["a"]);
    expect(o.recentLogs[0]?.typeLabel).toBe("울음");
  });
});

describe("500 synthetic days (performance)", () => {
  it("searching 500 days answers within 1 second", async () => {
    const db = h.fake.sqlite;
    db.exec("BEGIN");
    const day = db.prepare("INSERT INTO note_day VALUES (?, '합성반', ?, 1, 0, 1, ?)");
    const item = db.prepare("INSERT INTO note_item VALUES (?, ?, '교사', 'to_home', NULL, ?, ?)");
    const com = db.prepare("INSERT INTO note_comment VALUES (?, ?, 'parent', ?, ?)");
    const start = Date.UTC(2024, 0, 1);
    const filler = "블록을 쌓고 그림책을 보며 친구와 놀았어요. ".repeat(40); // 약 1000자
    for (let i = 0; i < 500; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      const body = `${filler}${i === 137 ? "희귀단어" : ""}`;
      day.run(date, 12 + Math.floor(i / 30), body.slice(0, 30));
      item.run(100_000 + i, date, `${date} 16:00`, body);
      com.run(i + 1, 100_000 + i, `${date} 17:00`, `감사합니다 ${String(i)}번째 댓글`);
    }
    db.exec("COMMIT");

    const t0 = performance.now();
    const rare = await list(`?q=${encodeURIComponent("희귀단어")}`);
    const common = await list(`?q=${encodeURIComponent("그림책")}&limit=50`);
    const none = await list(`?q=${encodeURIComponent("없는말없는말")}`);
    const ms = performance.now() - t0;
    console.log(`500 days: 3 searches in ${ms.toFixed(0)} ms`);
    expect(rare.items).toHaveLength(1);
    expect(common.items).toHaveLength(50);
    expect(common.nextCursor).not.toBeNull();
    expect(none.items).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });
});

describe("list preview line (greeting skipped, best report of the day)", () => {
  const addDay = (date: string, bodies: [number, string, string][]) => {
    h.fake.sqlite
      .prepare(
        "INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) VALUES (?, '합성반', 1, ?, 0, 0, ?)",
      )
      .run(date, bodies.length, "저장된 첫 줄");
    for (const [id, dir, body] of bodies) {
      h.fake.sqlite
        .prepare(
          "INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (?, ?, '교사', ?, NULL, ?, ?)",
        )
        .run(id, date, dir, `${date} 1${String(id % 10)}:00`, body);
    }
  };

  it("skips a greeting question, and picks the longer to_home report on two-report days", async () => {
    addDay("2021-05-01", [[9001, "to_home", "아이와 즐거운 주말 보내셨나요?\n\n블록을 쌓았어요."]]);
    addDay("2021-05-02", [
      [9002, "to_home", "준비물 안내."],
      [9003, "to_home", "모래놀이를 오래 했어요.\n물도 마셨어요."],
    ]);
    const r = await list("?limit=2");
    expect(r.items.map((i) => [i.date, i.firstLine])).toEqual([
      ["2021-05-02", "모래놀이를 오래 했어요."],
      ["2021-05-01", "블록을 쌓았어요."],
    ]);
    const o = overviewSchema.parse(await (await get("/api/overview")).json());
    expect(o.recentNotes[0]?.firstLine).toBe("모래놀이를 오래 했어요.");
  });

  it("falls back to the stored first line when a day has no report body", async () => {
    addDay("2021-05-03", []);
    const r = await list("?limit=1");
    expect(r.items[0]?.firstLine).toBe("저장된 첫 줄");
  });
});
