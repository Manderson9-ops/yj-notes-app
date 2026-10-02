import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN, TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = await createHarness();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cookie = cookieFrom(await h.login(TEST_PIN));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ID1 = "01926f4a-0000-7000-8000-000000000001";
const ID2 = "01926f4a-0000-7000-8000-000000000002";

const MEAL = {
  announced: "O",
  came: "달래서 옴",
  tantrum_min: 10,
  aggression: "없음",
  amount: "조금",
  snack_before: "조금",
  sick: "X",
  phone: "없음",
};

function body(over: Record<string, unknown> = {}) {
  return {
    type: "meal",
    occurredOn: "2020-03-11",
    recorder: "엄마",
    payload: MEAL,
    note: null,
    deviceId: "dev-test",
    ...over,
  };
}

function call(method: string, path: string, json?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: cookie };
  const init: RequestInit = { method, headers };
  if (method !== "GET") headers["Origin"] = ORIGIN;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  return h.handle(new Request(ORIGIN + path, init));
}

const put = (id: string, json: unknown) => call("PUT", `/api/logs/${id}`, json);
const count = (sql: string): number =>
  Number((h.fake.sqlite.prepare(sql).get() as { n: number }).n);

interface PutResult {
  item: {
    id: string;
    payload: Record<string, unknown>;
    alerts: { guide: string }[];
    updatedAt: string;
  };
  alerts: { field: string; message: string; guide: string }[];
  week: { start: string; end: string; count: number };
}

describe("GET /api/log-types", () => {
  it("returns the 4 seeded active types with parsed schema", async () => {
    const res = await call("GET", "/api/log-types");
    expect(res.status).toBe(200);
    const list = await res.json<{ code: string; label: string; schema: { fields: unknown[] } }[]>();
    expect(list.map((t) => t.code)).toEqual(["meal", "cry", "skin_pick", "bandage_step"]);
    expect(list[0]?.label).toBe("저녁 식사");
    expect(list[0]?.schema.fields).toHaveLength(8);
  });

  it("hides inactive types and skips broken definitions", async () => {
    h.fake.sqlite.exec("UPDATE log_type SET active = 0 WHERE code = 'cry'");
    h.fake.sqlite.exec("UPDATE log_type SET schema_json = '{broken' WHERE code = 'skin_pick'");
    const list = await (await call("GET", "/api/log-types")).json<{ code: string }[]>();
    expect(list.map((t) => t.code)).toEqual(["meal", "bandage_step"]);
  });

  it("a type added as data only (no code change) is accepted by PUT", async () => {
    h.fake.sqlite.exec(
      `INSERT INTO log_type (code, label_ko, schema_json, active) VALUES ('nap', '낮잠', '{"fields":[{"key":"min","label_ko":"시간","type":"int","min":0,"max":300,"required":true}],"alerts":[{"field":"min","op":">","value":200,"guide":"guide/01"}]}', 1)`,
    );
    const res = await put(ID1, body({ type: "nap", payload: { min: 250 } }));
    expect(res.status).toBe(200);
    expect((await res.json<PutResult>()).alerts[0]?.guide).toBe("guide/01");
  });
});

describe("PUT /api/logs/:id", () => {
  it("creates a log (200) with week count and no alert below the threshold", async () => {
    const res = await put(ID1, body());
    expect(res.status).toBe(200);
    const r = await res.json<PutResult>();
    expect(r.item.id).toBe(ID1);
    expect(r.item.payload).toEqual(MEAL);
    expect(r.alerts).toEqual([]);
    expect(r.week).toEqual({ start: "2020-03-09", end: "2020-03-15", count: 1 });
    const second = await (await put(ID2, body({ occurredOn: "2020-03-12" }))).json<PutResult>();
    expect(second.week.count).toBe(2);
  });

  it("is idempotent: same id + same body twice -> one row, no history, same updatedAt", async () => {
    const a = await (await put(ID1, body())).json<PutResult>();
    h.clock.t += 60_000;
    const b = await (await put(ID1, body())).json<PutResult>();
    expect(count("SELECT COUNT(*) AS n FROM family_log")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM family_log_history")).toBe(0);
    expect(b.item.updatedAt).toBe(a.item.updatedAt);
  });

  it("updates in place and keeps the earlier version in history", async () => {
    await put(ID1, body());
    h.clock.t += 60_000;
    const r = await (
      await put(ID1, body({ payload: { ...MEAL, tantrum_min: 30 }, recorder: "아빠" }))
    ).json<PutResult>();
    expect(r.item.payload["tantrum_min"]).toBe(30);
    expect(count("SELECT COUNT(*) AS n FROM family_log")).toBe(1);
    const hist = h.fake.sqlite.prepare("SELECT change, before_json FROM family_log_history").all();
    expect(hist).toHaveLength(1);
    expect(String(hist[0]?.["before_json"])).toContain('"tantrum_min":10');
  });

  it("returns the triggered alerts with the guide link from the type data", async () => {
    const r = await (
      await put(ID1, body({ payload: { ...MEAL, tantrum_min: 25, aggression: "사람 때림" } }))
    ).json<PutResult>();
    expect(r.alerts.map((a) => [a.field, a.guide])).toEqual([
      ["tantrum_min", "guide/05#3-1"],
      ["aggression", "guide/05#3-2"],
    ]);
    expect(r.alerts[0]?.message).toBe("떼쓴 시간 25분 이상이 기록됐어요.");
    const below = await (
      await put(ID2, body({ payload: { ...MEAL, tantrum_min: 24 } }))
    ).json<PutResult>();
    expect(below.alerts).toEqual([]);
  });

  it("422 validation_error with per-field messages", async () => {
    const bad = { ...MEAL, came: "몰라", tantrum_min: 999, extra: 1 } as Record<string, unknown>;
    delete bad["phone"];
    const res = await put(ID1, body({ payload: bad }));
    expect(res.status).toBe(422);
    const j = await res.json<{ error: string; fields: Record<string, string> }>();
    expect(j.error).toBe("validation_error");
    expect(j.fields).toEqual({
      "payload.came": "목록에서 골라 주세요.",
      "payload.tantrum_min": "0부터 120 사이 정수예요.",
      "payload.phone": "꼭 필요한 항목이에요.",
      "payload.extra": "알 수 없는 항목이에요.",
    });
    expect(count("SELECT COUNT(*) AS n FROM family_log")).toBe(0);
  });

  it.each([
    ["type", { type: "nope" }, "type"],
    ["empty cry payload", { type: "cry", payload: {} }, "payload.trigger"],
    ["date", { occurredOn: "2020-02-30" }, "occurredOn"],
    ["recorder", { recorder: "" }, "recorder"],
    ["note length", { note: "가".repeat(501) }, "note"],
    ["payload shape", { payload: [] }, "payload"],
    ["float minutes", { payload: { ...MEAL, tantrum_min: 1.5 } }, "payload.tantrum_min"],
    ["string minutes", { payload: { ...MEAL, tantrum_min: "5" } }, "payload.tantrum_min"],
  ])("422 on bad %s", async (_name, over, field) => {
    const res = await put(ID1, body(over));
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json<{ fields: object }>()).fields)).toContain(field);
  });

  it("422 on a malformed id and 400 on non-JSON body", async () => {
    expect((await put("not-a-uuid", body())).status).toBe(422);
    const res = await h.handle(
      new Request(`${ORIGIN}/api/logs/${ID1}`, {
        method: "PUT",
        headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
        body: "{oops",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("422 when the type of an existing log would change; 409 when it was deleted", async () => {
    await put(ID1, body());
    const t = await put(
      ID1,
      body({
        type: "cry",
        payload: { trigger: "밴드", minutes: 3, soothed_by: "안아줌", place: "집" },
      }),
    );
    expect(t.status).toBe(422);
    await call("DELETE", `/api/logs/${ID1}`);
    expect((await put(ID1, body())).status).toBe(409);
  });

  it("empty note is stored as null; error bodies carry no payload content", async () => {
    await put(ID1, body({ note: "   " }));
    const row = h.fake.sqlite.prepare("SELECT note FROM family_log").get();
    expect(row?.["note"]).toBeNull();
    const res = await put(ID2, body({ payload: { ...MEAL, came: "비밀문장" } }));
    expect(await res.text()).not.toContain("비밀문장");
  });

  it("cross-origin PUT is rejected by the guard (403)", async () => {
    const res = await h.handle(
      new Request(`${ORIGIN}/api/logs/${ID1}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body()),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/logs, GET /api/logs/:id, DELETE", () => {
  it("lists newest first, filters by type and date, and hides deleted logs", async () => {
    await put(ID1, body({ occurredOn: "2020-03-10" }));
    await put(ID2, body({ occurredOn: "2020-03-12" }));
    await put(
      "01926f4a-0000-7000-8000-000000000003",
      body({
        type: "cry",
        occurredOn: "2020-03-11",
        payload: { trigger: "밴드", minutes: 3, soothed_by: "안아줌", place: "집" },
      }),
    );
    const all = await (await call("GET", "/api/logs")).json<{ items: { id: string }[] }>();
    expect(all.items.map((i) => i.id)).toEqual([ID2, "01926f4a-0000-7000-8000-000000000003", ID1]);
    const meals = await (
      await call("GET", "/api/logs?type=meal&from=2020-03-11&to=2020-03-31")
    ).json<{ items: { id: string }[] }>();
    expect(meals.items.map((i) => i.id)).toEqual([ID2]);
    expect((await call("DELETE", `/api/logs/${ID2}`)).status).toBe(204);
    const after = await (
      await call("GET", "/api/logs?type=meal")
    ).json<{ items: { id: string }[] }>();
    expect(after.items.map((i) => i.id)).toEqual([ID1]);
    expect((await call("GET", "/api/logs?from=bad")).status).toBe(422);
    expect((await call("GET", "/api/logs?limit=0")).status).toBe(422);
    const lim = await (await call("GET", "/api/logs?limit=1")).json<{ items: unknown[] }>();
    expect(lim.items).toHaveLength(1);
  });

  it("GET /logs/:id returns one log; unknown or deleted -> 404", async () => {
    await put(ID1, body());
    expect((await call("GET", `/api/logs/${ID1}`)).status).toBe(200);
    expect((await call("GET", `/api/logs/${ID2}`)).status).toBe(404);
    expect((await call("GET", "/api/logs/zzz")).status).toBe(404);
    await call("DELETE", `/api/logs/${ID1}`);
    expect((await call("GET", `/api/logs/${ID1}`)).status).toBe(404);
  });

  it("DELETE is a soft delete (row and history kept), repeatable, 404 for unknown", async () => {
    await put(ID1, body());
    expect((await call("DELETE", `/api/logs/${ID1}`)).status).toBe(204);
    expect((await call("DELETE", `/api/logs/${ID1}`)).status).toBe(204);
    expect(count("SELECT COUNT(*) AS n FROM family_log WHERE deleted_at IS NOT NULL")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM family_log_history WHERE change = 'delete'")).toBe(1);
    expect((await call("DELETE", `/api/logs/${ID2}`)).status).toBe(404);
    expect((await call("DELETE", "/api/logs/zzz")).status).toBe(404);
  });
});

/** docs/01 F2-4: 기존 엑셀 기록표와 같은 지표. fixtures/seed 의 합성 기록(저녁 식사 5건)을 손으로 센 값과 대조한다. */
describe("GET /api/logs/summary (fixture 대조)", () => {
  beforeEach(() => {
    const sql = readFileSync(
      resolve(import.meta.dirname, "../../fixtures/seed/fixtures.sql"),
      "utf8",
    );
    for (const line of sql.split("\n")) {
      if (line.startsWith("INSERT INTO family_log ")) h.fake.sqlite.exec(line);
    }
  });

  interface S {
    total: number;
    from: string;
    to: string;
    weeks: {
      index: number;
      start: string;
      end: string;
      count: number;
      fields: Record<string, unknown>;
    }[];
    crosstabs: {
      rowOptions: string[];
      colOptions: string[];
      cells: number[][];
      rows: string;
      cols: string;
    }[];
    alerts: { logId: string; field: string; guide: string; occurredOn: string }[];
    alertCount: number;
  }
  const summary = async (q: string) => (await call("GET", `/api/logs/summary${q}`)).json<S>();

  it("weeks: 1주차 = 03-10~03-16 (3건), 2주차 = 03-17~03-23 (2건)", async () => {
    const s = await summary("?type=meal");
    expect(s.total).toBe(5);
    expect([s.from, s.to]).toEqual(["2020-03-10", "2020-03-22"]);
    expect(s.weeks.map((w) => [w.index, w.start, w.end, w.count])).toEqual([
      [1, "2020-03-10", "2020-03-16", 3],
      [2, "2020-03-17", "2020-03-23", 2],
    ]);
    // 떼쓴 시간: 1주차 0+10+30 = 40 (평균 13.3, 최대 30), 2주차 25+5 = 30 (평균 15, 최대 25)
    expect(s.weeks[0]?.fields["tantrum_min"]).toEqual({
      kind: "int",
      n: 3,
      sum: 40,
      avg: 13.3,
      max: 30,
    });
    expect(s.weeks[1]?.fields["tantrum_min"]).toEqual({
      kind: "int",
      n: 2,
      sum: 30,
      avg: 15,
      max: 25,
    });
    // 먹은 양: 1주차 많이1·조금1·안 먹음1, 2주차 많이1·조금1
    expect(s.weeks[0]?.fields["amount"]).toEqual({
      kind: "enum",
      counts: { 많이: 1, 조금: 1, "안 먹음": 1 },
    });
    expect(s.weeks[1]?.fields["amount"]).toEqual({
      kind: "enum",
      counts: { 많이: 1, 조금: 1, "안 먹음": 0 },
    });
    expect(s.weeks[0]?.fields["came"]).toEqual({
      kind: "enum",
      counts: { "바로 옴": 1, "달래서 옴": 1, "안 옴": 1 },
    });
  });

  it("crosstab 식전 간식 × 먹은 양", async () => {
    const s = await summary("?type=meal");
    const x = s.crosstabs[0];
    expect([x?.rows, x?.cols]).toEqual(["snack_before", "amount"]);
    expect(x?.rowOptions).toEqual(["없음", "조금", "많이"]);
    expect(x?.colOptions).toEqual(["많이", "조금", "안 먹음"]);
    expect(x?.cells).toEqual([
      [2, 1, 0], // 간식 없음: 많이 2(03-10, 03-22), 조금 1(03-19)
      [0, 1, 0], // 간식 조금: 조금 1(03-13)
      [0, 0, 1], // 간식 많이: 안 먹음 1(03-16)
    ]);
  });

  it("alerts: 03-16 떼쓴 30분, 03-19 떼쓴 25분 + 사람 때림 = 3건, 최신순", async () => {
    const s = await summary("?type=meal");
    expect(s.alertCount).toBe(3);
    expect(s.alerts.map((a) => [a.occurredOn, a.field, a.guide])).toEqual([
      ["2020-03-19", "tantrum_min", "guide/05#3-1"],
      ["2020-03-19", "aggression", "guide/05#3-2"],
      ["2020-03-16", "tantrum_min", "guide/05#3-1"],
    ]);
  });

  it("explicit range narrows weeks; other types produce their own crosstab-free summary", async () => {
    const r = await summary("?type=meal&from=2020-03-17&to=2020-03-23");
    expect(r.total).toBe(2);
    expect(r.weeks).toHaveLength(1);
    expect(r.alertCount).toBe(2); // 03-19 의 두 규칙
    const cry = await summary("?type=cry");
    expect(cry.total).toBe(5);
    expect(cry.crosstabs).toEqual([]);
    expect(cry.weeks[0]?.fields["minutes"]).toEqual({
      kind: "int",
      n: 3,
      sum: 18,
      avg: 6,
      max: 10,
    });
  });

  it("without type: counts and alerts across all types; unknown type -> 422; deleted logs excluded", async () => {
    const all = await summary("");
    expect(all.total).toBe(20);
    expect(all.weeks[0]?.fields).toEqual({});
    expect(all.alertCount).toBe(3);
    expect((await call("GET", "/api/logs/summary?type=zzz")).status).toBe(422);
    await call("DELETE", "/api/logs/00000000-0000-7000-8000-000000000004");
    expect((await summary("?type=meal")).alertCount).toBe(1);
  });

  it("empty range -> no weeks, zero totals", async () => {
    const s = await summary("?type=meal&from=2021-01-01&to=2021-01-31");
    expect(s.total).toBe(0);
    expect(s.weeks).toHaveLength(5);
    expect(s.weeks.every((w) => w.count === 0)).toBe(true);
    h.fake.sqlite.exec("DELETE FROM family_log");
    const none = await summary("?type=meal");
    expect(none.weeks).toEqual([]);
    expect(none.from).toBeNull();
  });

  it("fixture rows satisfy the stored type definitions (PUT accepts them as-is)", async () => {
    const rows = h.fake.sqlite
      .prepare("SELECT id, type, occurred_on, recorder, payload, note FROM family_log")
      .all() as {
      id: string;
      type: string;
      occurred_on: string;
      recorder: string;
      payload: string;
      note: string | null;
    }[];
    expect(rows).toHaveLength(20);
    for (const r of rows) {
      const res = await put(r.id, {
        type: r.type,
        occurredOn: r.occurred_on,
        recorder: r.recorder,
        payload: JSON.parse(r.payload),
        note: r.note,
        deviceId: "fixture-device",
      });
      expect(res.status, r.id).toBe(200);
    }
    expect(count("SELECT COUNT(*) AS n FROM family_log_history")).toBe(0); // 값이 같아 갱신 없음
  });
});
