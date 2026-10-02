import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import {
  evaluateAlerts,
  parseDefinition,
  validatePayload,
  type LogTypeDefinition,
} from "../../server/logs/definition.ts";
import { computeSummary, isValidDate, mondayWeekOf } from "../../server/logs/summary.ts";
import type { MockContext, MockModule } from "./index.ts";

/**
 * FAKE family-log API for `npm run dev:mock` / e2e (docs/05 "가족 기록"). Synthetic data only.
 * Question definitions are read from the real migrations (single source of truth), validation and
 * summary use the same pure functions as the real server.
 *
 * State is kept per browser session: the first request sets a `yj_mock_logs` cookie and every
 * request is served from that cookie's own store, so parallel e2e workers never see each other's logs.
 * Test hooks (mock only): GET /api/logs/__stats -> {puts, rows}; POST /api/logs/__fail {n} -> the next n PUTs get 503.
 */
interface TypeInfo {
  code: string;
  label: string;
  def: LogTypeDefinition;
}

interface Row {
  id: string;
  type: string;
  occurredOn: string;
  recorder: string;
  payload: Record<string, unknown>;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
  deleted: boolean;
}

interface Store {
  rows: Row[];
  puts: number;
  failNext: number;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COOKIE = "yj_mock_logs";

function loadTypes(): Map<string, TypeInfo> {
  const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
  const out = new Map<string, TypeInfo>();
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(dir + f, "utf8");
    const seed =
      /INSERT INTO log_type \(code, label_ko, schema_json, active\) VALUES \('(\w+)', '([^']+)', '(.*)', 1\);/g;
    for (const m of sql.matchAll(seed)) {
      const def = parseDefinition(m[3] ?? "");
      if (def) out.set(m[1] ?? "", { code: m[1] ?? "", label: m[2] ?? "", def });
    }
    const update = /UPDATE log_type SET schema_json = '(.*)' WHERE code = '(\w+)';/g;
    for (const m of sql.matchAll(update)) {
      const prev = out.get(m[2] ?? "");
      const def = parseDefinition(m[1] ?? "");
      if (prev && def) out.set(prev.code, { ...prev, def });
    }
  }
  return out;
}

const TYPES = loadTypes();
const STORES = new Map<string, Store>();

function scopeOf(req: IncomingMessage): { store: Store; setCookie?: string } {
  const m = new RegExp(`${COOKIE}=([\\w-]+)`).exec(req.headers.cookie ?? "");
  const known = m?.[1] !== undefined ? STORES.get(m[1]) : undefined;
  if (known) return { store: known };
  const id = m?.[1] ?? randomUUID();
  const store: Store = { rows: [], puts: 0, failNext: 0 };
  STORES.set(id, store);
  return { store, setCookie: `${COOKIE}=${id}; Path=/; SameSite=Strict` };
}

function itemOf(r: Row) {
  const def = TYPES.get(r.type)?.def;
  const alerts = def ? evaluateAlerts(def, r.payload) : [];
  return {
    id: r.id,
    type: r.type,
    occurredOn: r.occurredOn,
    recorder: r.recorder,
    payload: r.payload,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deviceId: r.deviceId,
    alerts,
  };
}

function validation(ctx: MockContext, h: Record<string, string>, fields: Record<string, string>) {
  ctx.send(422, { error: "validation_error", message: "입력을 확인해 주세요.", fields }, h);
}

async function handleLogs(req: IncomingMessage, ctx: MockContext): Promise<void> {
  const { store, setCookie } = scopeOf(req);
  const h: Record<string, string> = setCookie ? { "Set-Cookie": setCookie } : {};
  const method = req.method ?? "GET";
  const sub = ctx.subPath.replace(/^\//, "");
  const q = ctx.query;
  const live = () => store.rows.filter((r) => !r.deleted);

  if (sub === "__stats") {
    ctx.send(200, { puts: store.puts, rows: live().length }, h);
    return;
  }
  if (sub === "__fail" && method === "POST") {
    const j = (await ctx.readJson()) as { n?: number } | undefined;
    store.failNext = j?.n ?? 0;
    ctx.send(204, undefined, h);
    return;
  }

  const filter = () => {
    const type = q.get("type") ?? undefined;
    const from = q.get("from") ?? undefined;
    const to = q.get("to") ?? undefined;
    const bad: Record<string, string> = {};
    if (from && !isValidDate(from)) bad.from = "형식이 맞지 않아요.";
    if (to && !isValidDate(to)) bad.to = "형식이 맞지 않아요.";
    return { type, from, to, bad };
  };
  const matching = (f: ReturnType<typeof filter>) =>
    live()
      .filter(
        (r) =>
          (!f.type || r.type === f.type) &&
          (!f.from || r.occurredOn >= f.from) &&
          (!f.to || r.occurredOn <= f.to),
      )
      .sort(
        (a, b) =>
          b.occurredOn.localeCompare(a.occurredOn) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
      );

  if (sub === "" && method === "GET") {
    const f = filter();
    if (Object.keys(f.bad).length) {
      validation(ctx, h, f.bad);
      return;
    }
    ctx.send(200, { items: matching(f).map(itemOf) }, h);
    return;
  }
  if (sub === "summary" && method === "GET") {
    const f = filter();
    if (Object.keys(f.bad).length) {
      validation(ctx, h, f.bad);
      return;
    }
    if (f.type && !TYPES.has(f.type)) {
      validation(ctx, h, { type: "알 수 없는 종류예요." });
      return;
    }
    const summary = computeSummary({
      type: f.type ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      logs: matching(f).map((r) => ({
        id: r.id,
        type: r.type,
        occurredOn: r.occurredOn,
        payload: r.payload,
      })),
      defs: new Map([...TYPES].map(([k, v]) => [k, v.def])),
    });
    ctx.send(200, summary, h);
    return;
  }

  const id = sub.toLowerCase();
  if (!UUID_V7.test(id)) {
    if (method === "PUT") {
      validation(ctx, h, { id: "기록 번호 형식이 맞지 않아요." });
      return;
    }
    ctx.send(404, { error: "not_found", message: "찾을 수 없어요." }, h);
    return;
  }
  const existing = store.rows.find((r) => r.id === id);

  if (method === "GET") {
    if (!existing || existing.deleted) {
      ctx.send(404, { error: "not_found", message: "찾을 수 없어요." }, h);
      return;
    }
    ctx.send(200, { item: itemOf(existing) }, h);
    return;
  }
  if (method === "DELETE") {
    if (!existing) {
      ctx.send(404, { error: "not_found", message: "찾을 수 없어요." }, h);
      return;
    }
    existing.deleted = true;
    ctx.send(204, undefined, h);
    return;
  }
  if (method === "PUT") {
    store.puts += 1;
    if (store.failNext > 0) {
      store.failNext -= 1;
      ctx.send(503, { error: "quota_exceeded", message: "잠시 후 다시 시도해 주세요." }, h);
      return;
    }
    const b = (await ctx.readJson()) as Record<string, unknown> | undefined;
    if (!b || typeof b !== "object") {
      ctx.send(400, { error: "bad_request", message: "잘못된 요청이에요." }, h);
      return;
    }
    const info = typeof b.type === "string" ? TYPES.get(b.type) : undefined;
    if (!info) {
      validation(ctx, h, { type: "알 수 없는 종류예요." });
      return;
    }
    const fields: Record<string, string> = {};
    const date = b.occurredOn;
    if (typeof date !== "string" || !isValidDate(date))
      fields.occurredOn = "날짜 형식이 맞지 않아요.";
    const recorder = typeof b.recorder === "string" ? b.recorder.trim() : "";
    if (recorder.length < 1 || recorder.length > 12)
      fields.recorder = "기록자를 1~12자로 적어 주세요.";
    const checked = validatePayload(info.def, b.payload);
    if (!checked.ok) Object.assign(fields, checked.fields);
    if (Object.keys(fields).length) {
      validation(ctx, h, fields);
      return;
    }
    if (existing?.deleted) {
      ctx.send(409, { error: "deleted", message: "이미 지운 기록이에요." }, h);
      return;
    }
    const noteRaw = typeof b.note === "string" ? b.note.trim() : "";
    const now = new Date().toISOString();
    const row: Row = existing ?? {
      id,
      type: info.code,
      occurredOn: String(date),
      recorder,
      payload: checked.ok ? checked.value : {},
      note: null,
      createdAt: now,
      updatedAt: now,
      deviceId: typeof b.deviceId === "string" ? b.deviceId : "dev",
      deleted: false,
    };
    if (existing) {
      existing.occurredOn = String(date);
      existing.recorder = recorder;
      existing.payload = checked.ok ? checked.value : {};
      existing.updatedAt = now;
    } else {
      store.rows.push(row);
    }
    row.note = noteRaw === "" ? null : noteRaw;
    const week = mondayWeekOf(row.occurredOn);
    const count = live().filter(
      (r) => r.type === row.type && r.occurredOn >= week.start && r.occurredOn <= week.end,
    ).length;
    const item = itemOf(row);
    ctx.send(200, { item, alerts: item.alerts, week: { ...week, count } }, h);
    return;
  }
  ctx.send(405, { error: "method_not_allowed", message: "method not allowed" }, h);
}

export const logsModule: MockModule = {
  prefix: "/api/logs",
  handle: (req, _res, ctx) => handleLogs(req, ctx),
};

export const logTypesModule: MockModule = {
  prefix: "/api/log-types",
  handle: (req, _res, ctx) => {
    const { setCookie } = scopeOf(req);
    ctx.send(
      200,
      [...TYPES.values()].map((t) => ({ code: t.code, label: t.label, schema: t.def })),
      setCookie ? { "Set-Cookie": setCookie } : {},
    );
  },
};
