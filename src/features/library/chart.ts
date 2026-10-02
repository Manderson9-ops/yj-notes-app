// 성장 차트 계산(그리기와 분리해 단위 테스트한다). 자료는 건드리지 않고 좌표만 만든다.
import type { GrowthRef } from "./api";

/** min~max 를 덮는 보기 좋은 눈금(1·2·2.5·5 × 10^k). */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) {
    const pad = Math.abs(min) * 0.05 || 1;
    return niceTicks(min - pad, max + pad, target);
  }
  const rough = (max - min) / Math.max(1, target - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const start = Math.floor(min / unit + 1e-9) * unit;
  const ticks: number[] = [];
  for (let v = start; v < max + unit - 1e-9; v += unit) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** 나이(개월) 눈금: 최대 7개가 되는 가장 작은 간격. */
export function monthTicks(from: number, to: number): number[] {
  const step =
    [1, 2, 3, 6, 12, 24, 36, 60, 120, 240].find((s) => Math.ceil((to - from) / s) + 1 <= 7) ?? 240;
  const ticks: number[] = [];
  for (let v = Math.ceil(from / step) * step; v <= to; v += step) ticks.push(v);
  return ticks;
}

export type RefKey = "p3" | "p50" | "p97";

/** 기준 곡선의 한 개월 값(이웃 행 사이는 직선 보간, 범위 밖은 null). */
export function refAt(ref: GrowthRef[], key: RefKey, age: number): number | null {
  let lo: GrowthRef | undefined;
  let hi: GrowthRef | undefined;
  for (const r of ref) {
    if (r[key] === null) continue;
    if (r.ageMonth <= age) lo = r;
    if (r.ageMonth >= age) {
      hi = r;
      break;
    }
  }
  if (!lo || !hi) return null;
  const a = lo[key];
  const b = hi[key];
  if (a === null || b === null) return null;
  if (hi.ageMonth === lo.ageMonth) return a;
  return a + ((b - a) * (age - lo.ageMonth)) / (hi.ageMonth - lo.ageMonth);
}

/** [x0, x1] 안의 기준 곡선 꼭짓점(경계는 보간). 기준표가 구간을 덮지 못하면 덮는 부분만. */
export function refSeries(ref: GrowthRef[], key: RefKey, x0: number, x1: number) {
  const ages = new Set<number>([x0, x1]);
  for (const r of ref) if (r.ageMonth > x0 && r.ageMonth < x1) ages.add(r.ageMonth);
  const out: { age: number; value: number }[] = [];
  for (const age of [...ages].sort((a, b) => a - b)) {
    const value = refAt(ref, key, age);
    if (value !== null) out.push({ age, value });
  }
  return out;
}

export function linearScale(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** 눈금 표기: 불필요한 소수 0 을 없앤다. */
export function fmtTick(v: number): string {
  return String(Math.round(v * 100) / 100);
}
