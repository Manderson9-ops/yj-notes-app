import { ageInMonths, lmsPercentile } from "../../server/lib/growth.ts";
import type { MockModule } from "./index.ts";

/** FAKE 검진·성장 API (합성 자료만). 응답 모양은 server/routes/checkups.ts, growth.ts 와 같다. */
type Measure = "height_cm" | "weight_kg" | "head_cm" | "bmi";

interface M {
  id: number;
  measure: Measure;
  measuredOn: string;
  value: number;
  sheetPct: number | null;
  readStatus: "CONFIRMED" | "UNCERTAIN";
  note: string | null;
  checkupId: number | null;
}

const m = (
  id: number,
  checkupId: number | null,
  measuredOn: string,
  measure: Measure,
  value: number,
  sheetPct: number | null,
  readStatus: M["readStatus"] = "CONFIRMED",
  note: string | null = null,
): M => ({ id, checkupId, measuredOn, measure, value, sheetPct, readStatus, note });

const MEASUREMENTS: M[] = [
  m(101, 101, "2020-05-20", "height_cm", 62.5, 55),
  m(102, 101, "2020-05-20", "weight_kg", 6.4, 40, "CONFIRMED", "옷 입고 측정"),
  m(103, 101, "2020-05-20", "head_cm", 40.8, null, "UNCERTAIN"),
  m(104, 101, "2020-05-20", "bmi", 16.4, 60),
  m(105, 102, "2021-07-20", "height_cm", 81, 45),
  m(106, 102, "2021-07-20", "weight_kg", 10.2, 50, "CONFIRMED", "옷 입고 측정"),
  m(107, 102, "2021-07-20", "head_cm", 46, 35),
  m(108, 102, "2021-07-20", "bmi", 15.5, 42),
  m(109, null, "2020-09-12", "height_cm", 68.4, null, "CONFIRMED", "집에서 측정"),
  m(110, null, "2020-09-12", "weight_kg", 7.9, null, "CONFIRMED", "집에서 측정, 기저귀 착용"),
  m(111, null, "2021-01-20", "height_cm", 74.6, null, "CONFIRMED", "집에서 측정"),
  m(112, null, "2021-01-20", "weight_kg", 9, null, "CONFIRMED", "집에서 측정"),
];

const CHECKUPS = [
  {
    id: 102,
    roundLabel: "합성 5차 (18~24개월용)",
    examDate: "2021-07-20",
    ageMonths: 18,
    overall: "합성 종합 문구 예시 2",
    remarks: null,
    devResult: "합성 발달 문구 예시 2",
    imageUrl: null,
  },
  {
    id: 101,
    roundLabel: "합성 1차 (4~6개월용)",
    examDate: "2020-05-20",
    ageMonths: 4,
    overall: "합성 종합 문구 예시 1",
    remarks: "합성 참고 문구 예시 1",
    devResult: "합성 발달 문구 예시 1",
    imageUrl: null,
  },
];

const BIRTH = "2020-01-15";
const AGES = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const LMS: Record<Measure, { L: number[]; M: number[]; S: number[] }> = {
  height_cm: {
    L: [1],
    M: [49.1, 59.8, 65.7, 70.1, 74.0, 77.5, 80.7, 83.7, 86.4],
    S: [0.0379, 0.0364, 0.0368, 0.0372, 0.0378, 0.0381, 0.0386, 0.0391, 0.0395],
  },
  weight_kg: {
    L: [-0.38, -0.2, -0.18, -0.2, -0.24, -0.27, -0.3, -0.33, -0.35],
    M: [3.2, 5.8, 7.3, 8.2, 8.9, 9.6, 10.2, 10.9, 11.5],
    S: [0.142, 0.126, 0.125, 0.126, 0.127, 0.128, 0.129, 0.13, 0.131],
  },
  head_cm: {
    L: [1],
    M: [33.9, 40.2, 42.2, 43.6, 44.5, 45.2, 45.9, 46.4, 46.8],
    S: [0.0305, 0.0285, 0.0283, 0.0283, 0.0284, 0.0285, 0.0286, 0.0287, 0.0288],
  },
  bmi: {
    L: [-0.5],
    M: [13.3, 16.0, 16.1, 15.8, 15.6, 15.3, 15.2, 15.1, 15.0],
    S: [0.092, 0.085, 0.082, 0.081, 0.08, 0.079, 0.079, 0.079, 0.079],
  },
};
const Z = 1.8807936;
const at = (l: number, mm: number, s: number, z: number) =>
  l === 0 ? mm * Math.exp(s * z) : mm * Math.pow(1 + l * s * z, 1 / l);
const r1 = (x: number) => Math.round(x * 10) / 10;

function reference(measure: Measure) {
  const t = LMS[measure];
  return AGES.map((age, i) => {
    const l = t.L[i] ?? t.L[0] ?? 1;
    const mm = t.M[i] ?? 0;
    const s = t.S[i] ?? 0;
    return {
      ageMonth: age,
      l,
      m: mm,
      s,
      p3: r1(at(l, mm, s, -Z)),
      p50: mm,
      p97: r1(at(l, mm, s, Z)),
    };
  });
}

const ORDER: Measure[] = ["height_cm", "weight_kg", "head_cm", "bmi"];

export const checkupsMock: MockModule = {
  prefix: "/api/checkups",
  handle(req, _res, { subPath, send }) {
    if (req.method !== "GET") {
      send(405, { error: "method_not_allowed", message: "" });
      return;
    }
    const build = (c: (typeof CHECKUPS)[number]) => ({
      ...c,
      measurements: MEASUREMENTS.filter((x) => x.checkupId === c.id)
        .sort((a, b) => ORDER.indexOf(a.measure) - ORDER.indexOf(b.measure))
        .map((x) => ({
          id: x.id,
          measure: x.measure,
          measuredOn: x.measuredOn,
          value: x.value,
          sheetPct: x.sheetPct,
          readStatus: x.readStatus,
          note: x.note,
        })),
    });
    if (subPath === "") {
      send(200, { items: CHECKUPS.map(build) });
      return;
    }
    const c = CHECKUPS.find((x) => `/${String(x.id)}` === subPath);
    if (!c) {
      send(404, { error: "not_found", message: "찾을 수 없어요." });
      return;
    }
    send(200, build(c));
  },
};

export const growthMock: MockModule = {
  prefix: "/api/growth",
  handle(req, _res, { query, send }) {
    if (req.method !== "GET") {
      send(405, { error: "method_not_allowed", message: "" });
      return;
    }
    const measure = query.get("measure") as Measure | null;
    if (!measure || !ORDER.includes(measure)) {
      send(400, { error: "bad_request", message: "측정 종류를 확인해 주세요." });
      return;
    }
    const ref = reference(measure);
    const points = MEASUREMENTS.filter((x) => x.measure === measure)
      .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn) || a.id - b.id)
      .map((x) => {
        const ageMonths = ageInMonths(BIRTH, x.measuredOn);
        const row = ref.find((r) => r.ageMonth === ageMonths);
        return {
          id: x.id,
          date: x.measuredOn,
          ageMonths,
          value: x.value,
          sheetPct: x.sheetPct,
          recalcPct: row ? lmsPercentile(x.value, row.l, row.m, row.s) : null,
          readStatus: x.readStatus,
          note: x.note,
          fromCheckup: x.checkupId !== null,
        };
      });
    send(200, {
      measure,
      sex: "F",
      referenceSource: "SYNTH-LMS",
      points,
      reference: ref.map(({ ageMonth, p3, p50, p97 }) => ({ ageMonth, p3, p50, p97 })),
    });
  },
};
