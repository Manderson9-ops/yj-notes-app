// 성장 계산 도우미: 측정 이름 변환, 만 개월 수, LMS → 백분위 재계산(참고값).
// 판정(정상/지연 등)은 만들지 않는다. 숫자만 계산한다.

/** API 이름 -> measurement/growth_ref 의 measure 열 값. */
export const MEASURE_API_TO_COLUMN = {
  height_cm: "height_cm",
  weight_kg: "weight_kg",
  head_cm: "head_circ_cm",
  bmi: "bmi",
} as const;
export type ApiMeasure = keyof typeof MEASURE_API_TO_COLUMN;

export const MEASURE_COLUMN_TO_API: Record<string, ApiMeasure> = {
  height_cm: "height_cm",
  weight_kg: "weight_kg",
  head_circ_cm: "head_cm",
  bmi: "bmi",
};

/** 생일(YYYY-MM-DD)과 날짜(YYYY-MM-DD)로 만 개월 수를 센다. 생일보다 이르면 null. */
export function ageInMonths(birth: string, date: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!b || !d) return null;
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  const [dy, dm, dd] = [Number(d[1]), Number(d[2]), Number(d[3])];
  let months = (dy - by) * 12 + (dm - bm);
  if (dd < bd) months -= 1;
  return months < 0 ? null : months;
}

/** 표준정규 누적분포 (Abramowitz-Stegun 7.1.26, 오차 < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-((z * z) / 2));
  return 0.5 * (1 + (z >= 0 ? erf : -erf));
}

/** LMS 로 값의 백분위(0~100, 소수 첫째 자리)를 재계산한다. 입력이 모자라면 null. */
export function lmsPercentile(
  value: number,
  l: number | null,
  m: number | null,
  s: number | null,
): number | null {
  if (l === null || m === null || s === null || m <= 0 || s <= 0 || value <= 0) return null;
  const z = l === 0 ? Math.log(value / m) / s : (Math.pow(value / m, l) - 1) / (l * s);
  if (!Number.isFinite(z)) return null;
  return Math.round(normalCdf(z) * 1000) / 10;
}
