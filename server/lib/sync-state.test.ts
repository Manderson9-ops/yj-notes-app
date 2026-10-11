// sync-state 순수 함수: 20:00 KST 경계, +90분 미실행, 3시간 멈춤, 실패 코드, 첫 실행 전. 합성 시각만.
import { describe, expect, it } from "vitest";
import { deriveSyncSummary, lastScheduledMs, type SyncRunRow } from "./sync-state";

const at = (iso: string): number => Date.parse(iso);
// 20:00 KST == 11:00Z (한국은 서머타임이 없다)
const SCHED = "2030-03-10T11:00:00.000Z";

const run = (over: Partial<SyncRunRow> & Pick<SyncRunRow, "started_at">): SyncRunRow => ({
  id: 1,
  finished_at: null,
  status: "ok",
  code: null,
  new_reports: 0,
  new_comments: 0,
  last_note_date: null,
  ...over,
});
/** latest 만 주고 마지막 성공은 latest 가 성공일 때만 같은 행으로 본다. */
const derive = (latest: SyncRunRow | null, now: string) =>
  deriveSyncSummary(
    latest,
    latest && (latest.status === "ok" || latest.status === "no_new") ? latest : null,
    null,
    at(now),
  );

describe("lastScheduledMs (오늘 20:00 KST, 이전이면 어제)", () => {
  it("20:00 KST 직전은 어제, 정각부터는 오늘", () => {
    expect(lastScheduledMs(at("2030-03-10T10:59:59.999Z"))).toBe(at("2030-03-09T11:00:00.000Z"));
    expect(lastScheduledMs(at("2030-03-10T11:00:00.000Z"))).toBe(at(SCHED));
  });
  it("KST 자정(15:00Z)을 넘겨도 같은 예정 시각", () => {
    expect(lastScheduledMs(at("2030-03-10T14:59:59.999Z"))).toBe(at(SCHED));
    expect(lastScheduledMs(at("2030-03-10T15:00:00.000Z"))).toBe(at(SCHED));
    expect(lastScheduledMs(at("2030-03-11T10:59:59.999Z"))).toBe(at(SCHED));
  });
  it("UTC 날짜가 바뀌는 KST 09:00 도 문제없다", () => {
    expect(lastScheduledMs(at("2030-03-10T00:00:00.000Z"))).toBe(at("2030-03-09T11:00:00.000Z"));
  });
});

describe("deriveSyncSummary", () => {
  it("실행 기록이 없으면 none(배너 없음), 값은 비어 있다", () => {
    expect(derive(null, "2030-03-10T13:00:00.000Z")).toEqual({
      state: "none",
      lastOkAt: null,
      lastAttemptAt: null,
      newReports: 0,
      lastNoteDate: null,
      code: null,
    });
  });

  it("예정 뒤 성공 실행이 있으면 ok, 마지막 성공 시각·건수·날짜를 담는다", () => {
    const r = run({
      started_at: "2030-03-10T11:00:05.000Z",
      finished_at: "2030-03-10T11:20:00.000Z",
      new_reports: 5,
    });
    const s = deriveSyncSummary(r, r, "2030-03-07", at("2030-03-10T13:00:00.000Z"));
    expect(s).toMatchObject({
      state: "ok",
      lastOkAt: "2030-03-10T11:20:00.000Z",
      lastAttemptAt: "2030-03-10T11:00:05.000Z",
      newReports: 5,
      lastNoteDate: "2030-03-07",
      code: null,
    });
  });

  it("no_new 도 ok", () => {
    const r = run({ started_at: SCHED, finished_at: "2030-03-10T11:03:00.000Z", status: "no_new" });
    expect(derive(r, "2030-03-10T12:00:00.000Z").state).toBe("ok");
  });

  it("20:00 이전에는 어제 성공 기록만으로 ok(미실행 아님)", () => {
    const r = run({
      started_at: "2030-03-09T11:00:05.000Z",
      finished_at: "2030-03-09T11:10:00.000Z",
    });
    expect(derive(r, "2030-03-10T10:59:00.000Z").state).toBe("ok");
  });

  it("예정 시각 뒤 89분 59초까지는 기다리고, 90분이 되면 missed", () => {
    const old = run({
      started_at: "2030-03-09T11:00:05.000Z",
      finished_at: "2030-03-09T11:10:00.000Z",
    });
    expect(derive(old, "2030-03-10T12:29:59.999Z").state).toBe("ok");
    const s = derive(old, "2030-03-10T12:30:00.000Z");
    expect(s.state).toBe("missed");
    expect(s.code).toBe("missed");
    expect(s.lastOkAt).toBe("2030-03-09T11:10:00.000Z");
  });

  it("어제 실패한 채 오늘도 시작 기록이 없으면 missed 가 우선", () => {
    const old = run({ started_at: "2030-03-09T11:00:05.000Z", status: "failed", code: "media" });
    expect(derive(old, "2030-03-10T12:30:00.000Z").state).toBe("missed");
  });

  it("예정 시각 정각에 시작한 실행은 오늘 것으로 센다", () => {
    const r = run({ started_at: SCHED, finished_at: "2030-03-10T11:10:00.000Z" });
    expect(derive(r, "2030-03-10T13:00:00.000Z").state).toBe("ok");
  });

  it("running: 3시간 이내는 running(배너 없음), 넘으면 stuck", () => {
    const r = run({ started_at: "2030-03-10T11:00:05.000Z", status: "running" });
    expect(derive(r, "2030-03-10T14:00:05.000Z").state).toBe("running");
    const s = derive(r, "2030-03-10T14:00:05.001Z");
    expect(s.state).toBe("stuck");
    expect(s.code).toBe("stuck");
  });

  it("failed: 보고된 코드를 그대로 담는다", () => {
    for (const code of [
      "kidsnote_login",
      "kidsnote_api",
      "changed_existing",
      "media",
      "verify",
      "ingest",
    ]) {
      const r = run({
        started_at: SCHED,
        status: "failed",
        code,
        finished_at: "2030-03-10T11:02:00.000Z",
      });
      const s = derive(r, "2030-03-10T13:00:00.000Z");
      expect(s.state).toBe("failed");
      expect(s.code).toBe(code);
    }
  });

  it("failed: 코드가 없거나 형식이 틀리면 unknown", () => {
    for (const code of [null, "BAD CODE", "x".repeat(41)]) {
      const r = run({ started_at: SCHED, status: "failed", code });
      expect(derive(r, "2030-03-10T13:00:00.000Z").code).toBe("unknown");
    }
  });

  it("실패 뒤 다음 예정 시각 전에는 failed 가 이어진다", () => {
    const r = run({ started_at: SCHED, status: "failed", code: "verify" });
    expect(derive(r, "2030-03-11T10:59:00.000Z").state).toBe("failed");
  });

  it("마지막 성공 정보는 실패 뒤에도 남는다", () => {
    const ok = run({
      id: 1,
      started_at: "2030-03-09T11:00:00.000Z",
      finished_at: "2030-03-09T11:10:00.000Z",
      new_reports: 3,
    });
    const bad = run({ id: 2, started_at: SCHED, status: "failed", code: "media" });
    const s = deriveSyncSummary(bad, ok, "2030-03-08", at("2030-03-10T13:00:00.000Z"));
    expect(s).toMatchObject({
      state: "failed",
      newReports: 3,
      lastNoteDate: "2030-03-08",
      lastOkAt: "2030-03-09T11:10:00.000Z",
    });
  });
});
