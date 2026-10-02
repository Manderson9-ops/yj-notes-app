// 검진 (F3, docs/05). 결과지 문구·백분위는 원본 그대로 내려 보낸다(P1: 판정 문구를 만들지 않는다).
// 사진은 이번 범위 밖: imageUrl 은 항상 null.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { errorResponse, jsonResponse } from "../http/errors";
import { MEASURE_COLUMN_TO_API } from "../lib/growth";

interface CheckupRow {
  id: number;
  round_label: string;
  exam_date: string;
  age_months: number;
  overall: string;
  remarks: string | null;
  dev_result: string;
}
interface MeasurementRow {
  id: number;
  checkup_id: number;
  measured_on: string;
  measure: string;
  value: number;
  sheet_percentile: number | null;
  read_status: "CONFIRMED" | "UNCERTAIN";
  condition_note: string | null;
}

const COLUMNS = "id, round_label, exam_date, age_months, overall, remarks, dev_result";

function toMeasurement(m: MeasurementRow) {
  return {
    id: m.id,
    measure: MEASURE_COLUMN_TO_API[m.measure] ?? m.measure,
    measuredOn: m.measured_on,
    value: m.value,
    sheetPct: m.sheet_percentile,
    readStatus: m.read_status,
    note: m.condition_note,
  };
}

function toCheckup(c: CheckupRow, ms: MeasurementRow[]) {
  return {
    id: c.id,
    roundLabel: c.round_label,
    examDate: c.exam_date,
    ageMonths: c.age_months,
    overall: c.overall,
    remarks: c.remarks,
    devResult: c.dev_result,
    imageUrl: null,
    measurements: ms.filter((m) => m.checkup_id === c.id).map(toMeasurement),
  };
}

const MEASURE_ORDER =
  "CASE measure WHEN 'height_cm' THEN 1 WHEN 'weight_kg' THEN 2 WHEN 'head_circ_cm' THEN 3 ELSE 4 END";

export const checkupRoutes = new Hono<AppEnv>();

checkupRoutes.get("/api/checkups", async (c) => {
  const checkups = await c.env.DB.prepare(
    `SELECT ${COLUMNS} FROM checkup ORDER BY exam_date DESC, id DESC`,
  ).all<CheckupRow>();
  const ms = await c.env.DB.prepare(
    `SELECT id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note FROM measurement WHERE checkup_id IS NOT NULL ORDER BY ${MEASURE_ORDER}, id`,
  ).all<MeasurementRow>();
  return jsonResponse(200, {
    items: checkups.results.map((row) => toCheckup(row, ms.results)),
  });
});

checkupRoutes.get("/api/checkups/:id", async (c) => {
  const id = z.coerce.number().int().positive().safeParse(c.req.param("id"));
  if (!id.success) return errorResponse(404, "not_found", "찾을 수 없어요.");
  const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM checkup WHERE id = ?`)
    .bind(id.data)
    .first<CheckupRow>();
  if (!row) return errorResponse(404, "not_found", "찾을 수 없어요.");
  const ms = await c.env.DB.prepare(
    `SELECT id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note FROM measurement WHERE checkup_id = ? ORDER BY ${MEASURE_ORDER}, id`,
  )
    .bind(id.data)
    .all<MeasurementRow>();
  return jsonResponse(200, toCheckup(row, ms.results));
});
