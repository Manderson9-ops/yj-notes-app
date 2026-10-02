// 가족 기록 API (docs/05 "가족 기록", F2): /api/log-types, /api/logs, /api/logs/summary, /api/logs/:id.
// 입력은 log_type.schema_json 으로 검증한다(server/logs/definition.ts). 모든 라우트는 세션 필요(미들웨어).
// Family log API. Payloads are validated against the log type definition stored in D1.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { errorResponse, jsonResponse } from "../http/errors";
import {
  evaluateAlerts,
  parseDefinition,
  validatePayload,
  type LogTypeDefinition,
  type TriggeredAlert,
} from "../logs/definition";
import { computeSummary, isValidDate, mondayWeekOf, type SummaryLog } from "../logs/summary";

export const logRoutes = new Hono<AppEnv>();

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIST_LIMIT_DEFAULT = 200;
const LIST_LIMIT_MAX = 500;

interface LogTypeRow {
  code: string;
  label_ko: string;
  schema_json: string;
  active: number;
}
interface LogRow {
  id: string;
  type: string;
  occurred_on: string;
  recorder: string;
  payload: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string;
}

interface TypeInfo {
  code: string;
  label: string;
  active: boolean;
  def: LogTypeDefinition;
}

async function loadTypes(db: D1Database): Promise<Map<string, TypeInfo>> {
  const { results } = await db
    .prepare("SELECT code, label_ko, schema_json, active FROM log_type ORDER BY rowid")
    .all<LogTypeRow>();
  const out = new Map<string, TypeInfo>();
  for (const r of results) {
    const def = parseDefinition(r.schema_json);
    if (def) out.set(r.code, { code: r.code, label: r.label_ko, active: r.active === 1, def });
  }
  return out;
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toItem(r: LogRow, types: ReadonlyMap<string, TypeInfo>) {
  const payload = parsePayload(r.payload);
  const def = types.get(r.type)?.def;
  const alerts: TriggeredAlert[] = def ? evaluateAlerts(def, payload) : [];
  return {
    id: r.id,
    type: r.type,
    occurredOn: r.occurred_on,
    recorder: r.recorder,
    payload,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deviceId: r.device_id,
    alerts,
  };
}

function validation(fields: Record<string, string>): Response {
  return errorResponse(422, "validation_error", "입력을 확인해 주세요.", { fields });
}

const dateParam = z.string().refine(isValidDate);
const filterSchema = z.object({
  type: z.string().min(1).max(40).optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
});

function parseFilter(url: string) {
  const q = new URL(url).searchParams;
  const raw: Record<string, string> = {};
  for (const k of ["type", "from", "to", "limit"]) {
    const v = q.get(k);
    if (v !== null && v !== "") raw[k] = v;
  }
  const parsed = filterSchema.safeParse(raw);
  if (parsed.success) return { ok: true as const, ...parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues)
    fields[String(issue.path[0] ?? "query")] = "형식이 맞지 않아요.";
  return { ok: false as const, fields };
}

const SELECT_LOG =
  "SELECT id, type, occurred_on, recorder, payload, note, created_at, updated_at, deleted_at, device_id FROM family_log";

async function fetchLogs(
  db: D1Database,
  f: { type?: string | undefined; from?: string | undefined; to?: string | undefined },
  limit: number,
): Promise<LogRow[]> {
  const type = f.type ?? null;
  const from = f.from ?? null;
  const to = f.to ?? null;
  const { results } = await db
    .prepare(
      `${SELECT_LOG} WHERE deleted_at IS NULL AND (? IS NULL OR type = ?) AND (? IS NULL OR occurred_on >= ?) AND (? IS NULL OR occurred_on <= ?) ORDER BY occurred_on DESC, created_at DESC, id DESC LIMIT ?`,
    )
    .bind(type, type, from, from, to, to, limit)
    .all<LogRow>();
  return results;
}

logRoutes.get("/api/log-types", async (c) => {
  const types = await loadTypes(c.env.DB);
  const list = [...types.values()]
    .filter((t) => t.active)
    .map((t) => ({ code: t.code, label: t.label, schema: t.def }));
  return jsonResponse(200, list);
});

logRoutes.get("/api/logs", async (c) => {
  const f = parseFilter(c.req.url);
  if (!f.ok) return validation(f.fields);
  const types = await loadTypes(c.env.DB);
  const rows = await fetchLogs(c.env.DB, f, f.limit ?? LIST_LIMIT_DEFAULT);
  return jsonResponse(200, { items: rows.map((r) => toItem(r, types)) });
});

// 정적 경로가 :id 보다 먼저 와야 한다.
logRoutes.get("/api/logs/summary", async (c) => {
  const f = parseFilter(c.req.url);
  if (!f.ok) return validation(f.fields);
  const types = await loadTypes(c.env.DB);
  if (f.type !== undefined && !types.has(f.type)) {
    return validation({ type: "알 수 없는 종류예요." });
  }
  const rows = await fetchLogs(c.env.DB, f, 5000);
  const logs: SummaryLog[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    occurredOn: r.occurred_on,
    payload: parsePayload(r.payload),
  }));
  const defs = new Map([...types].map(([k, v]) => [k, v.def]));
  const summary = computeSummary({
    type: f.type ?? null,
    from: f.from ?? null,
    to: f.to ?? null,
    logs,
    defs,
  });
  return jsonResponse(200, summary);
});

logRoutes.get("/api/logs/:id", async (c) => {
  const id = c.req.param("id").toLowerCase();
  if (!UUID_V7.test(id)) return errorResponse(404, "not_found", "찾을 수 없어요.");
  const row = await c.env.DB.prepare(`${SELECT_LOG} WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<LogRow>();
  if (!row) return errorResponse(404, "not_found", "찾을 수 없어요.");
  return jsonResponse(200, { item: toItem(row, await loadTypes(c.env.DB)) });
});

const PutBody = z.object({
  type: z.string().min(1).max(40),
  occurredOn: dateParam,
  recorder: z.string().trim().min(1).max(12),
  payload: z.unknown(),
  note: z.string().max(500).nullable().optional(),
  deviceId: z.string().min(1).max(64),
});

const FIELD_HINTS: Record<string, string> = {
  type: "종류를 골라 주세요.",
  occurredOn: "날짜 형식이 맞지 않아요.",
  recorder: "기록자를 1~12자로 적어 주세요.",
  note: "메모는 500자까지예요.",
  deviceId: "기기 정보가 필요해요.",
};

logRoutes.put("/api/logs/:id", async (c) => {
  const id = c.req.param("id").toLowerCase();
  if (!UUID_V7.test(id)) return validation({ id: "기록 번호 형식이 맞지 않아요." });

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(400, "bad_request", "잘못된 요청이에요.");
  }
  const parsed = PutBody.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "body");
      fields[k] = FIELD_HINTS[k] ?? "형식이 맞지 않아요.";
    }
    return validation(fields);
  }
  const b = parsed.data;
  const db = c.env.DB;
  const types = await loadTypes(db);
  const info = types.get(b.type);
  if (!info?.active) return validation({ type: "알 수 없는 종류예요." });
  const checked = validatePayload(info.def, b.payload);
  if (!checked.ok) return validation(checked.fields);

  const payloadJson = JSON.stringify(checked.value);
  const note = b.note === undefined || b.note === null || b.note.trim() === "" ? null : b.note;
  const recorder = b.recorder;
  const nowIso = new Date(c.get("deps").now()).toISOString();

  // 같은 id 가 이미 있으면 갱신(멱등). 동시에 두 번 들어와도 한 행만 만든다.
  let existing = await db.prepare(`${SELECT_LOG} WHERE id = ?`).bind(id).first<LogRow>();
  if (!existing) {
    const ins = await db
      .prepare(
        "INSERT OR IGNORE INTO family_log (id, type, occurred_on, recorder, payload, note, created_at, updated_at, deleted_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      )
      .bind(id, b.type, b.occurredOn, recorder, payloadJson, note, nowIso, nowIso, b.deviceId)
      .run();
    if (ins.meta.changes === 0) {
      existing = await db.prepare(`${SELECT_LOG} WHERE id = ?`).bind(id).first<LogRow>();
    }
  }
  if (existing) {
    if (existing.deleted_at) return errorResponse(409, "deleted", "이미 지운 기록이에요.");
    if (existing.type !== b.type) return validation({ type: "종류는 바꿀 수 없어요." });
    const same =
      existing.occurred_on === b.occurredOn &&
      existing.recorder === recorder &&
      existing.payload === payloadJson &&
      existing.note === note;
    if (!same) {
      const before = JSON.stringify({
        type: existing.type,
        occurredOn: existing.occurred_on,
        recorder: existing.recorder,
        payload: parsePayload(existing.payload),
        note: existing.note,
      });
      await db.batch([
        db
          .prepare(
            "INSERT INTO family_log_history (log_id, changed_at, change, before_json) VALUES (?, ?, 'update', ?)",
          )
          .bind(id, nowIso, before),
        db
          .prepare(
            "UPDATE family_log SET occurred_on = ?, recorder = ?, payload = ?, note = ?, updated_at = ?, device_id = ? WHERE id = ?",
          )
          .bind(b.occurredOn, recorder, payloadJson, note, nowIso, b.deviceId, id),
      ]);
    }
  }

  const row = await db.prepare(`${SELECT_LOG} WHERE id = ?`).bind(id).first<LogRow>();
  if (!row) throw new Error("log row missing after write");
  const week = mondayWeekOf(row.occurred_on);
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM family_log WHERE deleted_at IS NULL AND type = ? AND occurred_on >= ? AND occurred_on <= ?",
    )
    .bind(row.type, week.start, week.end)
    .first<{ n: number }>();
  const item = toItem(row, types);
  return jsonResponse(200, {
    item,
    alerts: item.alerts,
    week: { start: week.start, end: week.end, count: count?.n ?? 0 },
  });
});

logRoutes.delete("/api/logs/:id", async (c) => {
  const id = c.req.param("id").toLowerCase();
  if (!UUID_V7.test(id)) return errorResponse(404, "not_found", "찾을 수 없어요.");
  const db = c.env.DB;
  const row = await db.prepare(`${SELECT_LOG} WHERE id = ?`).bind(id).first<LogRow>();
  if (!row) return errorResponse(404, "not_found", "찾을 수 없어요.");
  if (row.deleted_at === null) {
    const nowIso = new Date(c.get("deps").now()).toISOString();
    const before = JSON.stringify({
      type: row.type,
      occurredOn: row.occurred_on,
      recorder: row.recorder,
      payload: parsePayload(row.payload),
      note: row.note,
    });
    await db.batch([
      db
        .prepare(
          "INSERT INTO family_log_history (log_id, changed_at, change, before_json) VALUES (?, ?, 'delete', ?)",
        )
        .bind(id, nowIso, before),
      db
        .prepare("UPDATE family_log SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(nowIso, nowIso, id),
    ]);
  }
  return new Response(null, { status: 204 });
});
