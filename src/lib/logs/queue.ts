// 오프라인 대기열 (F2-6, T-13). 저장 버튼은 항상 IndexedDB 대기열에 먼저 쓰고(끊겨도 안 잃음),
// 연결돼 있으면 곧바로 PUT 한다. PUT 은 id(UUIDv7) 기준 멱등이라 같은 기록을 몇 번 보내도 서버에 한 행이다.
// 재전송: 연결 복구(online)·화면 복귀 때 즉시, 일시 오류(네트워크·429·5xx)면 지수 백오프(2초 → 최대 60초).
// 같은 id 는 동시에 한 요청만 보낸다(in-flight 공유). 대기 중인 기록은 이 기기 IndexedDB 에만 있고 보낸 뒤 지운다.
import { useSyncExternalStore } from "react";
import { ApiError, api } from "../api";
import type { LogBody, PutResult } from "./schemas";

export interface PendingLog {
  id: string;
  body: LogBody;
  createdAt: number;
  attempts: number;
  status: "pending" | "failed";
  /** failed 일 때 사람이 읽을 이유 */
  error?: string;
}

export interface QueueStore {
  getAll: () => Promise<PendingLog[]>;
  put: (entry: PendingLog) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export type SendOutcome =
  { state: "sent"; result: PutResult } | { state: "queued" } | { state: "failed"; error: ApiError };

const DB_NAME = "yj-queue";
const STORE = "pending";

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("indexeddb"));
    };
  });
}

/** 라이브러리 없이 쓰는 IndexedDB 저장소. */
export function createIdbStore(): QueueStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new Error("indexeddb"));
      };
    });
    return opened;
  };
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    getAll: async () => idbRequest((await tx("readonly")).getAll() as IDBRequest<PendingLog[]>),
    put: async (e) => {
      await idbRequest((await tx("readwrite")).put(e));
    },
    remove: async (id) => {
      await idbRequest((await tx("readwrite")).delete(id));
    },
  };
}

/** IndexedDB 를 못 쓰는 환경(시크릿 모드 등)·테스트용: 새로고침하면 사라진다. */
export function createMemoryStore(): QueueStore {
  const m = new Map<string, PendingLog>();
  return {
    getAll: () => Promise.resolve([...m.values()]),
    put: (e) => {
      m.set(e.id, e);
      return Promise.resolve();
    },
    remove: (id) => {
      m.delete(id);
      return Promise.resolve();
    },
  };
}

export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 60_000;

/** n 번째 연속 실패 뒤 기다릴 시간: 2s, 4s, 8s, … 최대 60s */
export function backoffDelayMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

/** 다시 시도하면 될 수 있는 오류인가(연결 끊김·시간 초과·한도·서버 오류). */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

interface Deps {
  store: QueueStore;
  send: (entry: PendingLog) => Promise<PutResult>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  online: () => boolean;
}

const defaults = (): Deps => ({
  store: typeof indexedDB === "undefined" ? createMemoryStore() : createIdbStore(),
  send: async (entry) => {
    // 응답 검사 스키마는 첫 화면 크기를 위해 필요할 때 내려받는다.
    const { putResultSchema } = await import("./schemas");
    return api("PUT", `/logs/${entry.id}`, { body: entry.body, schema: putResultSchema });
  },
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (h) => {
    window.clearTimeout(h as number);
  },
  online: () => navigator.onLine,
});

let deps: Deps = defaults();
let entries: PendingLog[] = [];
let loaded = false;
let failures = 0;
let timer: unknown;
const inflight = new Map<string, Promise<SendOutcome>>();
let flushing: Promise<void> | undefined;
const listeners = new Set<() => void>();
const sentHandlers = new Set<(result: PutResult) => void>();

export interface QueueCounts {
  pending: number;
  failed: number;
}
let counts: QueueCounts = { pending: 0, failed: 0 };

function emit(): void {
  const next = {
    pending: entries.filter((e) => e.status === "pending").length,
    failed: entries.filter((e) => e.status === "failed").length,
  };
  if (next.pending !== counts.pending || next.failed !== counts.failed) counts = next;
  listeners.forEach((l) => {
    l();
  });
}

/** 테스트에서 저장소·전송을 바꿔 끼우고 상태를 초기화한다. */
export function configureQueue(over: Partial<Deps> = {}): void {
  if (timer !== undefined) deps.clearTimer(timer);
  deps = { ...defaults(), ...over };
  entries = [];
  loaded = false;
  failures = 0;
  timer = undefined;
  inflight.clear();
  flushing = undefined;
  counts = { pending: 0, failed: 0 };
  emit();
}

export async function loadQueue(): Promise<void> {
  if (loaded) return;
  try {
    entries = (await deps.store.getAll()).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    entries = [];
  }
  loaded = true;
  emit();
}

export function useQueueCounts(): QueueCounts {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => counts,
    () => counts,
  );
}

export function listFailed(): PendingLog[] {
  return entries.filter((e) => e.status === "failed");
}

export function getPending(id: string): PendingLog | undefined {
  return entries.find((e) => e.id === id);
}

export function onSent(handler: (result: PutResult) => void): () => void {
  sentHandlers.add(handler);
  return () => sentHandlers.delete(handler);
}

async function persist(entry: PendingLog): Promise<void> {
  entries = [...entries.filter((e) => e.id !== entry.id), entry].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  emit();
  try {
    await deps.store.put(entry);
  } catch {
    /* 저장소 오류여도 이번 화면 동안은 메모리에 남아 재전송된다 */
  }
}

async function drop(id: string): Promise<void> {
  entries = entries.filter((e) => e.id !== id);
  emit();
  try {
    await deps.store.remove(id);
  } catch {
    /* 지우기 실패: 다음에 같은 id 로 다시 보내도 멱등 */
  }
}

function scheduleRetry(): void {
  failures += 1;
  if (timer !== undefined) deps.clearTimer(timer);
  timer = deps.setTimer(() => {
    timer = undefined;
    void flushQueue();
  }, backoffDelayMs(failures));
}

/** 한 건 전송. 같은 id 가 이미 나가는 중이면 그 결과를 같이 받는다. */
function sendEntry(entry: PendingLog): Promise<SendOutcome> {
  const running = inflight.get(entry.id);
  if (running) return running;
  const p = (async (): Promise<SendOutcome> => {
    try {
      const result = await deps.send(entry);
      await drop(entry.id);
      failures = 0;
      sentHandlers.forEach((h) => {
        h(result);
      });
      return { state: "sent", result };
    } catch (e) {
      const error = e instanceof ApiError ? e : new ApiError(0, "network", "");
      if (error.status === 401) return { state: "queued" }; // 로그인 후 다시 시도
      if (isTransient(error)) {
        await persist({ ...entry, attempts: entry.attempts + 1 });
        scheduleRetry();
        return { state: "queued" };
      }
      await persist({
        ...entry,
        attempts: entry.attempts + 1,
        status: "failed",
        error: error.code,
      });
      return { state: "failed", error };
    }
  })().finally(() => {
    inflight.delete(entry.id);
  });
  inflight.set(entry.id, p);
  return p;
}

/**
 * 저장: 대기열에 먼저 쓰고, 연결돼 있으면 바로 보낸다.
 * 서버가 입력을 거부하면(422 등) 대기열에서 빼고 ApiError 를 던진다 — 사용자가 고칠 수 있게.
 */
export async function submitLog(id: string, body: LogBody): Promise<SendOutcome> {
  await loadQueue();
  const entry: PendingLog = { id, body, createdAt: Date.now(), attempts: 0, status: "pending" };
  await persist(entry);
  if (!deps.online()) return { state: "queued" };
  const out = await sendEntry(entry);
  if (out.state === "failed") {
    await drop(id);
    throw out.error;
  }
  return out;
}

/** 대기 중인 기록을 오래된 순서로 보낸다. 일시 오류가 나면 멈추고 백오프로 다시 예약한다. */
export function flushQueue(): Promise<void> {
  flushing ??= (async () => {
    await loadQueue();
    for (const e of entries.filter((x) => x.status === "pending")) {
      if (!deps.online()) break;
      const out = await sendEntry(e);
      if (out.state === "queued") break;
    }
  })().finally(() => {
    flushing = undefined;
  });
  return flushing;
}

export async function discardFailed(id: string): Promise<void> {
  await loadQueue();
  await drop(id);
}

/** 앱이 로그인된 동안 켜 둔다: 시작 시·연결 복구·화면 복귀 때 보낸다. 반환값으로 끈다. */
export function startQueueSync(): () => void {
  const kick = () => {
    failures = 0;
    void flushQueue();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") kick();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", onVisible);
  void flushQueue();
  return () => {
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", onVisible);
    if (timer !== undefined) {
      deps.clearTimer(timer);
      timer = undefined;
    }
  };
}
