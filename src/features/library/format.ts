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

/** 제목 끝의 폴더 표시 ` (guide/)` 는 사람에게 뜻이 없다. */
const FOLDER_TAIL = /\s*\([A-Za-z0-9_-]+\/\)\s*$/;
const DASH = " — ";
const COMMON_SUFFIX_MIN = 3;

/**
 * 목록 제목 다듬기: 폴더 꼬리를 떼고, 여러 문서가 같은 ` — 꼬리` 로 끝나면(아이 이름 등) 그 꼬리를 뗀다.
 * 같은 제목 목록에서 같은 규칙으로 만들므로 목록과 문서 화면이 일치한다.
 */
export function displayTitles(
  docs: readonly { slug: string; title: string }[],
): Map<string, string> {
  const base = docs.map((d) => ({ slug: d.slug, title: d.title.replace(FOLDER_TAIL, "").trim() }));
  const tails = new Map<string, number>();
  for (const d of base) {
    const at = d.title.lastIndexOf(DASH);
    if (at > 0) {
      const tail = d.title.slice(at);
      tails.set(tail, (tails.get(tail) ?? 0) + 1);
    }
  }
  const common = [...tails].filter(([, n]) => n >= COMMON_SUFFIX_MIN).map(([t]) => t);
  return new Map(
    base.map((d) => {
      const tail = common.find((t) => d.title.endsWith(t));
      return [d.slug, tail ? d.title.slice(0, d.title.length - tail.length).trim() : d.title];
    }),
  );
}
