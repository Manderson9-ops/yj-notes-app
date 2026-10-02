// 자료실·검진·성장 API 클라이언트 (docs/05). 스키마는 서버 응답의 요약이며 판정 필드는 없다.
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api, ApiError } from "../../lib/api";

export const reportMetaSchema = z.object({
  slug: z.string(),
  title: z.string(),
  kind: z.enum(["html", "markdown"]),
  group: z.enum(["report", "guide", "wiki"]),
  generatedAt: z.string(),
  sourceCommit: z.string(),
  verifyOk: z.boolean(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

const reportListSchema = z.object({ items: z.array(reportMetaSchema) });

export const measureSchema = z.enum(["height_cm", "weight_kg", "head_cm", "bmi"]);
export type Measure = z.infer<typeof measureSchema>;
const readStatusSchema = z.enum(["CONFIRMED", "UNCERTAIN"]);

const checkupMeasurementSchema = z.object({
  id: z.number(),
  measure: measureSchema,
  measuredOn: z.string(),
  value: z.number(),
  sheetPct: z.number().nullable(),
  readStatus: readStatusSchema,
  note: z.string().nullable(),
});
export type CheckupMeasurement = z.infer<typeof checkupMeasurementSchema>;

export const checkupSchema = z.object({
  id: z.number(),
  roundLabel: z.string(),
  examDate: z.string(),
  ageMonths: z.number(),
  overall: z.string(),
  remarks: z.string().nullable(),
  devResult: z.string(),
  imageUrl: z.string().nullable(),
  measurements: z.array(checkupMeasurementSchema),
});
export type Checkup = z.infer<typeof checkupSchema>;
const checkupListSchema = z.object({ items: z.array(checkupSchema) });

const growthPointSchema = z.object({
  id: z.number(),
  date: z.string(),
  ageMonths: z.number().nullable(),
  value: z.number(),
  sheetPct: z.number().nullable(),
  recalcPct: z.number().nullable(),
  readStatus: readStatusSchema,
  note: z.string().nullable(),
  fromCheckup: z.boolean(),
});
export type GrowthPoint = z.infer<typeof growthPointSchema>;

const growthRefSchema = z.object({
  ageMonth: z.number(),
  p3: z.number().nullable(),
  p50: z.number().nullable(),
  p97: z.number().nullable(),
});
export type GrowthRef = z.infer<typeof growthRefSchema>;

const growthSchema = z.object({
  measure: measureSchema,
  sex: z.string(),
  referenceSource: z.string().nullable(),
  points: z.array(growthPointSchema),
  reference: z.array(growthRefSchema),
});
export type Growth = z.infer<typeof growthSchema>;

export function useReports() {
  return useQuery({
    queryKey: ["reports"],
    queryFn: () => api("GET", "/reports", { schema: reportListSchema }),
  });
}

export function useReportMeta(slug: string) {
  return useQuery({
    queryKey: ["reports", slug],
    queryFn: () => api("GET", `/reports/${encodeURIComponent(slug)}`, { schema: reportMetaSchema }),
  });
}

/** 마크다운 원문(text). JSON 이 아니라 api() 를 쓰지 않는다. */
export function useReportRaw(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", slug, "raw"],
    enabled,
    queryFn: async () => {
      let res: Response;
      try {
        res = await fetch(`/api/reports/${encodeURIComponent(slug)}/raw`, {
          credentials: "same-origin",
        });
      } catch {
        throw new ApiError(0, "network", "network error");
      }
      if (!res.ok) throw new ApiError(res.status, "http", "");
      return res.text();
    },
  });
}

export function useCheckups() {
  return useQuery({
    queryKey: ["checkups"],
    queryFn: () => api("GET", "/checkups", { schema: checkupListSchema }),
  });
}

export function useGrowth(measure: Measure) {
  return useQuery({
    queryKey: ["growth", measure],
    queryFn: () => api("GET", `/growth?measure=${measure}`, { schema: growthSchema }),
  });
}
