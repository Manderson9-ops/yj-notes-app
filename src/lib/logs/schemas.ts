// 가족 기록 API 응답 스키마 (docs/05 "가족 기록"). 서버가 정본이고 여기는 화면용 복사본이다.
import { z } from "zod";

const base = { key: z.string(), label_ko: z.string(), required: z.boolean() };

export const logFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("enum"), options: z.array(z.string()) }),
  z.object({
    ...base,
    type: z.literal("int"),
    min: z.number(),
    max: z.number(),
    unit: z.string().optional(),
    presets: z.array(z.number()).optional(),
  }),
  z.object({ ...base, type: z.literal("text"), max: z.number().optional() }),
]);
export type LogField = z.infer<typeof logFieldSchema>;

export const logTypeSchema = z.object({
  code: z.string(),
  label: z.string(),
  schema: z.object({
    fields: z.array(logFieldSchema),
    alerts: z.array(z.object({ field: z.string(), guide: z.string() })).default([]),
    summary: z
      .object({
        highlight: z.array(z.string()).optional(),
        crosstabs: z.array(z.object({ rows: z.string(), cols: z.string() })).optional(),
      })
      .optional(),
  }),
});
export type LogType = z.infer<typeof logTypeSchema>;
export const logTypesSchema = z.array(logTypeSchema);

export const alertSchema = z.object({ field: z.string(), message: z.string(), guide: z.string() });
export type LogAlert = z.infer<typeof alertSchema>;

export const answerSchema = z.union([z.string(), z.number()]);
export type Answers = Record<string, string | number>;

export const logItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  occurredOn: z.string(),
  recorder: z.string(),
  payload: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deviceId: z.string(),
  alerts: z.array(alertSchema),
});
export type LogItem = z.infer<typeof logItemSchema>;

export const logListSchema = z.object({ items: z.array(logItemSchema) });
export const logOneSchema = z.object({ item: logItemSchema });

export const putResultSchema = z.object({
  item: logItemSchema,
  alerts: z.array(alertSchema),
  week: z.object({ start: z.string(), end: z.string(), count: z.number() }),
});
export type PutResult = z.infer<typeof putResultSchema>;

/** PUT /logs/:id 요청 본문 */
export interface LogBody {
  type: string;
  occurredOn: string;
  recorder: string;
  payload: Record<string, unknown>;
  note: string | null;
  deviceId: string;
}

const fieldStatSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum"), counts: z.record(z.string(), z.number()) }),
  z.object({
    kind: z.literal("int"),
    n: z.number(),
    sum: z.number(),
    avg: z.number().nullable(),
    max: z.number().nullable(),
  }),
]);
export type FieldStat = z.infer<typeof fieldStatSchema>;

export const summarySchema = z.object({
  type: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  total: z.number(),
  weeks: z.array(
    z.object({
      index: z.number(),
      start: z.string(),
      end: z.string(),
      count: z.number(),
      fields: z.record(z.string(), fieldStatSchema),
    }),
  ),
  crosstabs: z.array(
    z.object({
      rows: z.string(),
      cols: z.string(),
      rowLabel: z.string(),
      colLabel: z.string(),
      rowOptions: z.array(z.string()),
      colOptions: z.array(z.string()),
      cells: z.array(z.array(z.number())),
    }),
  ),
  alerts: z.array(
    z.object({
      logId: z.string(),
      type: z.string(),
      occurredOn: z.string(),
      field: z.string(),
      message: z.string(),
      guide: z.string(),
    }),
  ),
  alertCount: z.number(),
});
export type LogsSummary = z.infer<typeof summarySchema>;
