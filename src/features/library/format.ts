import type { Measure } from "./api";

const DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 2020-03-02 -> 2020년 3월 2일 (월). 날짜만 쓰고 시간대 변환은 하지 않는다. */
export function formatKoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dow = DOW[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] ?? "";
  return `${String(y)}년 ${String(mo)}월 ${String(d)}일 (${dow})`;
}

export const MEASURES: { id: Measure; label: string; unit: string }[] = [
  { id: "height_cm", label: "키", unit: "cm" },
  { id: "weight_kg", label: "몸무게", unit: "kg" },
  { id: "head_cm", label: "머리둘레", unit: "cm" },
  { id: "bmi", label: "BMI", unit: "" },
];

export function measureInfo(id: Measure): { id: Measure; label: string; unit: string } {
  return MEASURES.find((m) => m.id === id) ?? { id, label: id, unit: "" };
}

/** 값 + 단위. 숫자는 API 값 그대로. */
export function withUnit(value: number, measure: Measure): string {
  const unit = measureInfo(measure).unit;
  return unit ? `${String(value)} ${unit}` : String(value);
}
