// 자동 업데이트 기록(T-S1): start/finish 라우트, 인증 경계, 입력 검증, 409, 정리, overview 필드. 합성 값만.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rows, sessionCall, workerCall } from "../test-utils/ask";
import {
  ORIGIN,
  TEST_PIN,
  TEST_WORKER_TOKEN,
  cookieFrom,
  createHarness,
  type Harness,
} from "../test-utils/harness";

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

const nowIso = () => new Date(h.clock.t).toISOString();
const start = (startedAt: unknown = nowIso()) =>
  workerCall(h, "POST", "/api/worker/sync/start", { startedAt });
const finish = (id: number | string, body: unknown) =>
  workerCall(h, "POST", `/api/worker/sync/${String(id)}/finish`, body);
const startId = async (): Promise<number> => (await (await start()).json<{ id: number }>()).id;
const row = (id: number) =>
  rows<Record<string, unknown>>(h, `SELECT * FROM sync_run WHERE id = ${String(id)}`)[0];
const sync = async () =>
  (
    await (
      await sessionCall(h, cookie, "GET", "/api/overview")
    ).json<{
      sync: Record<string, unknown>;
    }>()
  ).sync;

describe("POST /api/worker/sync/start", () => {
  it("running 행을 만들고 id 를 돌려준다", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const { id } = await res.json<{ id: number }>();
    expect(row(id)).toMatchObject({
      status: "running",
      started_at: nowIso(),
      finished_at: null,
      created_at: nowIso(),
    });
  });

  it("잘못된 입력은 422: 형식·누락·여분 키·너무 먼 시각", async () => {
    for (const body of [
      {},
      { startedAt: "어제" },
      { startedAt: 5 },
      { startedAt: nowIso(), extra: 1 },
      null,
      "x",
    ]) {
      expect(
        (await workerCall(h, "POST", "/api/worker/sync/start", body)).status,
        JSON.stringify(body),
      ).toBe(422);
    }
    expect((await start(new Date(h.clock.t + 11 * 60_000).toISOString())).status).toBe(422);
    expect((await start(new Date(h.clock.t - 3 * 86_400_000).toISOString())).status).toBe(422);
    expect((await start(new Date(h.clock.t + 9 * 60_000).toISOString())).status).toBe(200);
    expect(rows(h, "SELECT id FROM sync_run")).toHaveLength(1);
  });

  it("90일 지난 행은 기록할 때 지운다", async () => {
    const old = await startId();
    h.fake.sqlite
      .prepare("UPDATE sync_run SET created_at = ? WHERE id = ?")
      .run(new Date(h.clock.t - 90 * 86_400_000 - 1000).toISOString(), old);
    const keep = await startId(); // 아직 90일 안
    h.clock.t += 1000;
    const recent = await startId();
    const ids = rows<{ id: number }>(h, "SELECT id FROM sync_run").map((r) => r.id);
    expect(ids).toEqual([keep, recent]);
  });
});

describe("POST /api/worker/sync/:id/finish", () => {
  it("ok: 건수·날짜·단계를 저장하고 204, 끝난 시각은 서버 시계", async () => {
    const id = await startId();
    h.clock.t += 60_000;
    const res = await finish(id, {
      status: "ok",
      stage: "report",
      code: "needs_reading",
      newReports: 5,
      newComments: 12,
      lastNoteDate: "2030-01-01",
    });
    expect(res.status).toBe(204);
    expect(row(id)).toMatchObject({
      status: "ok",
      stage: "report",
      code: "needs_reading",
      new_reports: 5,
      new_comments: 12,
      last_note_date: "2030-01-01",
      finished_at: nowIso(),
    });
  });

  it("failed 는 code 필수, no_new 는 새 알림장 0 이어야 한다", async () => {
    const id = await startId();
    expect((await finish(id, { status: "failed" })).status).toBe(422);
    expect((await finish(id, { status: "failed", stage: "media", code: "media" })).status).toBe(
      204,
    );
    const id2 = await startId();
    expect((await finish(id2, { status: "no_new", newReports: 1 })).status).toBe(422);
    expect((await finish(id2, { status: "no_new", newReports: 0 })).status).toBe(204);
  });

  it("엄격한 검증: 코드 형식·단계·숫자 범위·날짜·여분 키(본문 등)", async () => {
    const id = await startId();
    const bad: unknown[] = [
      { status: "running" },
      { status: "ok", code: "Bad-Code" },
      { status: "ok", code: "a".repeat(41) },
      { status: "ok", code: "" },
      { status: "ok", code: "한글" },
      { status: "ok", stage: "other" },
      { status: "ok", newReports: -1 },
      { status: "ok", newReports: 10001 },
      { status: "ok", newReports: 1.5 },
      { status: "ok", newReports: "3" },
      { status: "ok", lastNoteDate: "2030-13-01" },
      { status: "ok", lastNoteDate: "2030-01-32" },
      { status: "ok", lastNoteDate: "2030-1-1" },
      { status: "ok", log: "본문 텍스트" },
      { status: "ok", name: "x" },
      {},
      [],
      null,
    ];
    for (const body of bad) {
      expect((await finish(id, body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(row(id)?.status).toBe("running");
  });

  it("두 번째 보고는 409 이고 첫 결과가 그대로 남는다(멱등)", async () => {
    const id = await startId();
    expect((await finish(id, { status: "failed", code: "verify" })).status).toBe(204);
    const again = await finish(id, { status: "ok", newReports: 9 });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "conflict" });
    expect(row(id)).toMatchObject({ status: "failed", code: "verify", new_reports: null });
  });

  it("없는 id 는 404, 숫자가 아닌 id 는 404", async () => {
    expect((await finish(999, { status: "ok" })).status).toBe(404);
    expect((await finish("abc", { status: "ok" })).status).toBe(404);
    expect((await finish("1e3", { status: "ok" })).status).toBe(404);
  });

  it("오류 응답에 입력 내용이 없다", async () => {
    const id = await startId();
    const res = await finish(id, { status: "ok", code: "비밀 본문" });
    expect(JSON.stringify(await res.json())).not.toContain("비밀");
  });
});

describe("인증 경계", () => {
  it("토큰 없음·틀린 토큰·세션 쿠키만으로는 401", async () => {
    const id = await startId();
    const calls: [string, string, unknown][] = [
      ["POST", "/api/worker/sync/start", { startedAt: nowIso() }],
      ["POST", `/api/worker/sync/${String(id)}/finish`, { status: "ok" }],
    ];
    for (const [m, p, b] of calls) {
      expect((await workerCall(h, m, p, b, null)).status, p).toBe(401);
      expect((await workerCall(h, m, p, b, "wrong-token-0123456789")).status, p).toBe(401);
      expect((await sessionCall(h, cookie, m, p, b)).status, p).toBe(401);
    }
    expect(row(id)?.status).toBe("running");
    expect(rows(h, "SELECT id FROM sync_run")).toHaveLength(1);
  });

  it("토큰 해시 미설정이면 503(닫힌 채로)", async () => {
    delete h.env.ASK_WORKER_TOKEN_HASH;
    expect((await start()).status).toBe(503);
    expect(rows(h, "SELECT id FROM sync_run")).toHaveLength(0);
  });

  it("경로 우회(대소문자·인코딩·슬래시·끝 슬래시)는 통과하지 못한다", async () => {
    for (const path of [
      "/API/worker/sync/start",
      "/api/Worker/sync/start",
      "/api/worker/sync/start/",
      "//api/worker/sync/start",
      "/api/worker//sync/start",
      "/api/worker/sync%2fstart",
      "/api/%77orker/sync/start",
      "/api/worker/sync/1/finish/",
      "/api/worker/sync/%31/finish",
    ]) {
      const res = await workerCall(h, "POST", path, { startedAt: nowIso() });
      expect(res.status, path).toBe(404);
    }
    expect(rows(h, "SELECT id FROM sync_run")).toHaveLength(0);
  });

  it("Origin 이 다른 요청은 403, JSON 이 아닌 본문은 415", async () => {
    const other = await h.handle(
      new Request(`${ORIGIN}/api/worker/sync/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_WORKER_TOKEN}`,
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ startedAt: nowIso() }),
      }),
    );
    expect(other.status).toBe(403);
    const text = await h.handle(
      new Request(`${ORIGIN}/api/worker/sync/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_WORKER_TOKEN}`, "Content-Type": "text/plain" },
        body: "x",
      }),
    );
    expect(text.status).toBe(415);
  });

  it("Bearer 로는 overview 를 읽을 수 없다(세션 영역)", async () => {
    const res = await h.handle(
      new Request(`${ORIGIN}/api/overview`, {
        headers: { Authorization: `Bearer ${TEST_WORKER_TOKEN}` },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("overview.sync", () => {
  it("기록이 없으면 none", async () => {
    expect(await sync()).toEqual({
      state: "none",
      lastOkAt: null,
      lastAttemptAt: null,
      newReports: 0,
      lastNoteDate: null,
      code: null,
    });
  });

  it("성공·실패·미실행·멈춤이 화면 값으로 이어진다", async () => {
    // 어제 저녁 성공(2029-12-31 20:00 KST)
    h.clock.t = Date.parse("2029-12-31T11:00:10.000Z");
    const a = await startId();
    h.clock.t += 120_000;
    await finish(a, { status: "ok", newReports: 4, lastNoteDate: "2029-12-29" });
    h.clock.t = Date.parse("2030-01-01T00:00:00.000Z");
    expect(await sync()).toMatchObject({
      state: "ok",
      newReports: 4,
      lastNoteDate: "2029-12-29",
      code: null,
    });

    // 오늘 20:00 KST + 90분 지나도 기록 없음 -> missed
    h.clock.t = Date.parse("2030-01-01T12:30:00.000Z");
    expect(await sync()).toMatchObject({ state: "missed", code: "missed", newReports: 4 });

    // 오늘 실행이 실패로 끝남
    h.clock.t = Date.parse("2030-01-01T11:00:05.000Z");
    const b = await startId();
    await finish(b, { status: "failed", stage: "fetch", code: "kidsnote_login" });
    h.clock.t = Date.parse("2030-01-01T13:00:00.000Z");
    expect(await sync()).toMatchObject({
      state: "failed",
      code: "kidsnote_login",
      newReports: 4,
      lastNoteDate: "2029-12-29",
    });

    // 멈춘 실행
    h.clock.t = Date.parse("2030-01-02T11:00:05.000Z");
    await startId();
    h.clock.t = Date.parse("2030-01-02T14:01:00.000Z");
    expect(await sync()).toMatchObject({ state: "stuck", code: "stuck" });
  });

  it("응답에는 필드 6개뿐(본문·이름 없음)", async () => {
    expect(Object.keys(await sync()).sort()).toEqual([
      "code",
      "lastAttemptAt",
      "lastNoteDate",
      "lastOkAt",
      "newReports",
      "state",
    ]);
  });
});
