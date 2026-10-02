import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { uuidv7 } from "./ids";
import {
  BACKOFF_MAX_MS,
  backoffDelayMs,
  configureQueue,
  createMemoryStore,
  discardFailed,
  flushQueue,
  isTransient,
  listFailed,
  submitLog,
  type PendingLog,
} from "./queue";
import type { LogBody, PutResult } from "./schemas";

const body = (n = 1): LogBody => ({
  type: "meal",
  occurredOn: "2020-03-1" + String(n),
  recorder: "엄마",
  payload: { came: "바로 옴" },
  note: null,
  deviceId: "dev",
});

const OK: PutResult = {
  item: {
    id: "x",
    type: "meal",
    occurredOn: "2020-03-11",
    recorder: "엄마",
    payload: {},
    note: null,
    createdAt: "",
    updatedAt: "",
    deviceId: "dev",
    alerts: [],
  },
  alerts: [],
  week: { start: "2020-03-09", end: "2020-03-15", count: 1 },
};

let online = true;
let timers: { fn: () => void; ms: number }[] = [];
const store = () => createMemoryStore();

function setup(send: (e: PendingLog) => Promise<PutResult>, s = store()) {
  timers = [];
  configureQueue({
    store: s,
    send,
    online: () => online,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return s;
}

beforeEach(() => {
  online = true;
});

describe("backoff", () => {
  it("doubles from 2s and caps at 60s", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffDelayMs)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ]);
    expect(backoffDelayMs(50)).toBe(BACKOFF_MAX_MS);
  });
  it("treats network, 429 and 5xx as transient; 4xx validation as permanent", () => {
    expect(isTransient(new ApiError(0, "network", ""))).toBe(true);
    expect(isTransient(new ApiError(503, "x", ""))).toBe(true);
    expect(isTransient(new ApiError(429, "x", ""))).toBe(true);
    expect(isTransient(new ApiError(422, "x", ""))).toBe(false);
    expect(isTransient(new ApiError(409, "x", ""))).toBe(false);
  });
});

describe("queue", () => {
  it("online: sends right away and leaves nothing behind", async () => {
    const send = vi.fn(() => Promise.resolve(OK));
    const s = setup(send);
    const out = await submitLog(uuidv7(), body());
    expect(out.state).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(await s.getAll()).toEqual([]);
  });

  it("offline: keeps entries in the store, sends nothing, then flushes each exactly once", async () => {
    online = false;
    const send = vi.fn(() => Promise.resolve(OK));
    const s = setup(send);
    const a = uuidv7();
    const b = uuidv7();
    expect((await submitLog(a, body(1))).state).toBe("queued");
    expect((await submitLog(b, body(2))).state).toBe("queued");
    expect(send).not.toHaveBeenCalled();
    expect((await s.getAll()).map((e) => e.id).sort()).toEqual([a, b].sort());

    online = true;
    await Promise.all([flushQueue(), flushQueue()]); // 같은 순간 두 번 불려도
    await flushQueue();
    expect(send.mock.calls.map((c) => (c as unknown as [PendingLog])[0].id).sort()).toEqual(
      [a, b].sort(),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(await s.getAll()).toEqual([]);
  });

  it("a second submit of the same id while the first is in flight shares one request", async () => {
    let release: (r: PutResult) => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<PutResult>((r) => {
          release = r;
        }),
    );
    setup(send);
    const id = uuidv7();
    const p1 = submitLog(id, body());
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    const p2 = flushQueue();
    release(OK);
    await Promise.all([p1, p2]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("transient failure keeps the entry and schedules a backoff retry that doubles", async () => {
    const send = vi
      .fn<(e: PendingLog) => Promise<PutResult>>()
      .mockRejectedValueOnce(new ApiError(503, "quota_exceeded", ""))
      .mockRejectedValueOnce(new ApiError(0, "network", ""))
      .mockResolvedValue(OK);
    const s = setup(send);
    const id = uuidv7();
    expect((await submitLog(id, body())).state).toBe("queued");
    expect(timers.map((t) => t.ms)).toEqual([2000]);
    expect((await s.getAll())[0]?.attempts).toBe(1);

    timers[0]?.fn();
    await flushQueue();
    await vi.waitFor(() => {
      expect(timers.map((t) => t.ms)).toEqual([2000, 4000]);
    });

    timers[1]?.fn();
    await vi.waitFor(async () => {
      expect(await s.getAll()).toEqual([]);
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(new Set(send.mock.calls.map((c) => c[0].id))).toEqual(new Set([id])); // 같은 id 로만
  });

  it("422 on submit throws to the form and does not stay in the queue", async () => {
    const s = setup(() =>
      Promise.reject(new ApiError(422, "validation_error", "", undefined, { type: "x" })),
    );
    await expect(submitLog(uuidv7(), body())).rejects.toMatchObject({ status: 422 });
    expect(await s.getAll()).toEqual([]);
  });

  it("a permanent error found while flushing marks the entry failed (kept, visible, discardable)", async () => {
    online = false;
    const s = setup(() => Promise.reject(new ApiError(409, "deleted", "")));
    const id = uuidv7();
    await submitLog(id, body());
    online = true;
    await flushQueue();
    expect(listFailed().map((e) => e.id)).toEqual([id]);
    expect((await s.getAll())[0]?.status).toBe("failed");
    await flushQueue(); // 실패 건은 다시 보내지 않는다
    await discardFailed(id);
    expect(await s.getAll()).toEqual([]);
  });

  it("401 leaves the entry for after login and schedules nothing", async () => {
    const s = setup(() => Promise.reject(new ApiError(401, "auth_required", "")));
    expect((await submitLog(uuidv7(), body())).state).toBe("queued");
    expect(timers).toEqual([]);
    expect(await s.getAll()).toHaveLength(1);
  });

  it("a restart reloads the queue from the store", async () => {
    online = false;
    const s = setup(() => Promise.resolve(OK));
    const id = uuidv7();
    await submitLog(id, body());
    const send = vi.fn(() => Promise.resolve(OK));
    setup(send, s); // 새로 시작(메모리 상태 초기화), 저장소는 그대로
    online = true;
    await flushQueue();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("uuidv7", () => {
  it("has version 7, variant 8-b and sorts by time", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
