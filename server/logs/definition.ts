// 가족 기록 종류 정의(log_type.schema_json) — 질문·경고 규칙·요약 설정을 데이터로 둔다 (docs/03 §3, F2-1).
// 순수 TypeScript(Workers·D1 의존 없음): 서버 라우트와 dev mock 이 같은 코드를 쓴다.
// Log type definition: questions, alert rules and summary config live in data, not code.
import { z } from "zod";

const KEY = /^[a-z][a-z0-9_]*$/;

const enumField = z.object({
  key: z.string().regex(KEY),
  label_ko: z.string().min(1),
  type: z.literal("enum"),
  options: z.array(z.string().min(1)).min(1),
  required: z.boolean(),
});
const intField = z.object({
  key: z.string().regex(KEY),
  label_ko: z.string().min(1),
  type: z.literal("int"),
  min: z.number().int(),
  max: z.number().int(),
  unit: z.string().optional(),
  /** 화면에 먼저 보여 줄 값(칩). 나머지는 「직접」 입력. */
  presets: z.array(z.number().int()).optional(),
  required: z.boolean(),
});
const textField = z.object({
  key: z.string().regex(KEY),
  label_ko: z.string().min(1),
  type: z.literal("text"),
  max: z.number().int().positive().optional(),
  required: z.boolean(),
});

const fieldSchema = z.discriminatedUnion("type", [enumField, intField, textField]);

const alertSchema = z.object({
  field: z.string().regex(KEY),
  op: z.enum([">=", ">", "<=", "<", "==", "!="]),
  value: z.union([z.string(), z.number()]),
  /** 가이드 문서 경로 + 선택 앵커. 예: "guide/05#3-1" */
  guide: z.string().regex(/^[A-Za-z0-9_\-/]+(#[A-Za-z0-9_-]+)?$/),
  message_ko: z.string().optional(),
});

const summaryConfigSchema = z.object({
  /** 주차 비교·목록 요약에 보여 줄 필드(없으면 enum·int 전부) */
  highlight: z.array(z.string().regex(KEY)).optional(),
  /** 교차표(행 필드 × 열 필드, 둘 다 enum) */
  crosstabs: z
    .array(z.object({ rows: z.string().regex(KEY), cols: z.string().regex(KEY) }))
    .optional(),
});

export const logTypeDefinitionSchema = z.object({
  fields: z.array(fieldSchema).min(1),
  alerts: z.array(alertSchema).default([]),
  summary: summaryConfigSchema.optional(),
});

export type LogField = z.infer<typeof fieldSchema>;
export type LogAlertRule = z.infer<typeof alertSchema>;
export type LogTypeDefinition = z.infer<typeof logTypeDefinitionSchema>;

/** schema_json 문자열 -> 정의. 깨져 있으면 null (호출 쪽이 그 종류를 건너뛴다). */
export function parseDefinition(json: string): LogTypeDefinition | null {
  try {
    const parsed = logTypeDefinitionSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 정의로 payload 검증기를 만든다. 정의에 없는 키는 거부한다. */
export function buildPayloadSchema(def: LogTypeDefinition): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of def.fields) {
    let s: z.ZodType;
    if (f.type === "enum") {
      s = z.enum(f.options as [string, ...string[]]);
    } else if (f.type === "int") {
      s = z.number().int().min(f.min).max(f.max);
    } else {
      s = z.string().max(f.max ?? 200);
    }
    shape[f.key] = f.required ? s : s.optional();
  }
  return z.strictObject(shape);
}

export type FieldErrors = Record<string, string>;

/** payload 검증. 실패 시 {"payload.키": "한국어 이유"} (docs/05 422 fields). */
export function validatePayload(
  def: LogTypeDefinition,
  payload: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; fields: FieldErrors } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, fields: { payload: "항목 묶음이 필요해요." } };
  }
  const raw = payload as Record<string, unknown>;
  const parsed = buildPayloadSchema(def).safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };

  const byKey = new Map(def.fields.map((f) => [f.key, f]));
  const fields: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const k of issue.keys) fields[`payload.${k}`] = "알 수 없는 항목이에요.";
      continue;
    }
    const key = String(issue.path[0] ?? "");
    const field = byKey.get(key);
    const name = `payload.${key}`;
    if (field === undefined) {
      fields["payload"] = "항목이 맞지 않아요.";
    } else if (raw[key] === undefined) {
      fields[name] = "꼭 필요한 항목이에요.";
    } else if (field.type === "enum") {
      fields[name] = "목록에서 골라 주세요.";
    } else if (field.type === "int") {
      fields[name] =
        typeof raw[key] === "number"
          ? `${String(field.min)}부터 ${String(field.max)} 사이 정수예요.`
          : "숫자로 적어 주세요.";
    } else {
      fields[name] = `${String(field.max ?? 200)}자까지 적을 수 있어요.`;
    }
  }
  return { ok: false, fields };
}

export interface TriggeredAlert {
  field: string;
  message: string;
  guide: string;
}

function compare(op: LogAlertRule["op"], a: unknown, b: string | number): boolean {
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case ">=":
        return a >= b;
      case ">":
        return a > b;
      case "<=":
        return a <= b;
      case "<":
        return a < b;
      case "==":
        return a === b;
      case "!=":
        return a !== b;
    }
  }
  if (op === "==") return a === b;
  if (op === "!=") return a !== b;
  return false; // 문자열은 같음·다름만 비교한다
}

/** 경고 규칙 평가(F2-5). 규칙은 정의 데이터에서 온다 — 코드에 하드코딩하지 않는다. */
export function evaluateAlerts(
  def: LogTypeDefinition,
  payload: Record<string, unknown>,
): TriggeredAlert[] {
  const out: TriggeredAlert[] = [];
  const labels = new Map(def.fields.map((f) => [f.key, f.label_ko]));
  for (const rule of def.alerts) {
    if (!compare(rule.op, payload[rule.field], rule.value)) continue;
    out.push({
      field: rule.field,
      guide: rule.guide,
      message:
        rule.message_ko ?? `${labels.get(rule.field) ?? rule.field} 기준에 해당하는 기록이 있어요.`,
    });
  }
  return out;
}
