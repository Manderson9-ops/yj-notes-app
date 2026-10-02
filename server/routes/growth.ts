// 성장 곡선 (F3, docs/05): 측정 점 + 기준 곡선. 결과지 백분위(sheetPct)는 원본 그대로,
// recalcPct 는 기준표 LMS 로 다시 계산한 참고값(없으면 null). 판정 문구는 만들지 않는다.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { errorResponse, jsonResponse } from "../http/errors";
import { ageInMonths, lmsPercentile, MEASURE_API_TO_COLUMN } from "../lib/growth";

const Query = z.object({
  measure: z.enum(["height_cm", "weight_kg", "head_cm", "bmi"]),
});

interface PointRow {
  id: number;
  checkup_id: number | null;
  measured_on: string;
  value: number;
  sheet_percentile: number | null;
  read_status: "CONFIRMED" | "UNCERTAIN";
  condition_note: string | null;
  checkup_age: number | null;
}
interface RefRow {
  age_month: number;
  source_id: string;
  l: number | null;
  m: number | null;
  s: number | null;
  p3: number | null;
  p50: number | null;
  p97: number | null;
}

export const growthRoutes = new Hono<AppEnv>();

growthRoutes.get("/api/growth", async (c) => {
  const q = Query.safeParse({ measure: c.req.query("measure") });
  if (!q.success) return errorResponse(400, "bad_request", "측정 종류를 확인해 주세요.");
  const column = MEASURE_API_TO_COLUMN[q.data.measure];
  const db = c.env.DB;

  const settings = await db
    .prepare("SELECT key, value FROM app_setting WHERE key IN ('child_birth_date', 'child_sex')")
    .all<{ key: string; value: string }>();
  const setting = new Map(settings.results.map((r) => [r.key, r.value]));
  const birth = setting.get("child_birth_date") ?? null;
  const sex = setting.get("child_sex") === "M" ? "M" : "F";

  const pts = await db
    .prepare(
      `SELECT m.id, m.checkup_id, m.measured_on, m.value, m.sheet_percentile, m.read_status, m.condition_note, k.age_months AS checkup_age
         FROM measurement m LEFT JOIN checkup k ON k.id = m.checkup_id
        WHERE m.measure = ? ORDER BY m.measured_on ASC, m.id ASC`,
    )
    .bind(column)
    .all<PointRow>();
  const refs = await db
    .prepare(
      "SELECT age_month, source_id, l, m, s, p3, p50, p97 FROM growth_ref WHERE measure = ? AND sex = ? ORDER BY age_month ASC",
    )
    .bind(column, sex)
    .all<RefRow>();
  const refByAge = new Map(refs.results.map((r) => [r.age_month, r]));

  const points = pts.results.map((p) => {
    // 생일 설정이 없으면 검진 회차에 적힌 개월 수로 대신한다(없으면 null).
    const ageMonths = (birth ? ageInMonths(birth, p.measured_on) : null) ?? p.checkup_age;
    const ref = ageMonths === null ? undefined : refByAge.get(ageMonths);
    return {
      id: p.id,
      date: p.measured_on,
      ageMonths,
      value: p.value,
      sheetPct: p.sheet_percentile,
      recalcPct: ref ? lmsPercentile(p.value, ref.l, ref.m, ref.s) : null,
      readStatus: p.read_status,
      note: p.condition_note,
      fromCheckup: p.checkup_id !== null,
    };
  });

  return jsonResponse(200, {
    measure: q.data.measure,
    sex,
    referenceSource: refs.results[0]?.source_id ?? null,
    points,
    reference: refs.results.map((r) => ({
      ageMonth: r.age_month,
      p3: r.p3,
      p50: r.p50,
      p97: r.p97,
    })),
  });
});
