// 직접 그린 SVG 성장 차트(차트 라이브러리 없음). 색은 library.css 의 토큰 클래스만 쓴다.
// 점은 키보드·터치로 고를 수 있는 버튼 역할이고, 같은 정보는 표 보기로도 제공된다(GrowthPage).
import type { Growth, GrowthPoint, Measure } from "./api";
import { fmtTick, linearScale, monthTicks, niceTicks, refSeries, type RefKey } from "./chart";
import { formatKoDate, measureInfo, withUnit } from "./format";

const W = 320;
const H = 300;
const M = { l: 46, r: 34, t: 14, b: 50 };
const HIT_R = 24;
const REF_KEYS: { key: RefKey; label: string; cls: string }[] = [
  { key: "p97", label: "97", cls: "chart-ref chart-ref-edge" },
  { key: "p50", label: "50", cls: "chart-ref chart-ref-mid" },
  { key: "p3", label: "3", cls: "chart-ref chart-ref-edge" },
];

export function plottable(points: GrowthPoint[]) {
  return points.filter((p): p is GrowthPoint & { ageMonths: number } => p.ageMonths !== null);
}

export function GrowthChart({
  data,
  measure,
  selectedId,
  onSelect,
}: {
  data: Growth;
  measure: Measure;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const pts = plottable(data.points);
  if (pts.length === 0) return null;

  const ages = pts.map((p) => p.ageMonths);
  let x0 = Math.max(0, Math.min(...ages) - 2);
  let x1 = Math.max(...ages) + 2;
  if (x1 - x0 < 6) x1 = x0 + 6;
  x0 = Math.floor(x0);
  x1 = Math.ceil(x1);

  const series = REF_KEYS.map((k) => ({ ...k, pts: refSeries(data.reference, k.key, x0, x1) }));
  const ys = [...pts.map((p) => p.value), ...series.flatMap((s) => s.pts.map((q) => q.value))];
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 7);
  const y0 = yTicks[0] ?? 0;
  const y1 = yTicks[yTicks.length - 1] ?? 1;
  const xs = linearScale(x0, x1, M.l, W - M.r);
  const ysc = linearScale(y0, y1, H - M.b, M.t);
  const info = measureInfo(measure);

  const path = (list: { age: number; value: number }[]) =>
    list
      .map((q, i) => `${i === 0 ? "M" : "L"}${xs(q.age).toFixed(1)},${ysc(q.value).toFixed(1)}`)
      .join(" ");

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      role="group"
      aria-label={`${info.label} 성장 곡선 그래프`}
    >
      {yTicks.map((v) => (
        <g key={`y${String(v)}`}>
          <line className="chart-grid" x1={M.l} x2={W - M.r} y1={ysc(v)} y2={ysc(v)} />
          <text
            className="chart-tick"
            x={M.l - 6}
            y={ysc(v)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {fmtTick(v)}
          </text>
        </g>
      ))}
      {monthTicks(x0, x1).map((v) => (
        <g key={`x${String(v)}`}>
          <line className="chart-grid" x1={xs(v)} x2={xs(v)} y1={M.t} y2={H - M.b} />
          <text className="chart-tick" x={xs(v)} y={H - M.b + 16} textAnchor="middle">
            {v}
          </text>
        </g>
      ))}
      <line className="chart-axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
      <line className="chart-axis" x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} />
      <text className="chart-label" x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle">
        나이 (개월)
      </text>
      <text
        className="chart-label"
        transform={`translate(11 ${String((M.t + H - M.b) / 2)}) rotate(-90)`}
        textAnchor="middle"
      >
        {info.unit ? `${info.label} (${info.unit})` : info.label}
      </text>

      {series.map((s) =>
        s.pts.length > 1 ? (
          <g key={s.key}>
            <path className={s.cls} d={path(s.pts)} />
            <text
              className="chart-ref-label"
              x={xs(s.pts[s.pts.length - 1]?.age ?? x1) + 3}
              y={ysc(s.pts[s.pts.length - 1]?.value ?? 0)}
              dominantBaseline="middle"
            >
              {s.label}%
            </text>
          </g>
        ) : null,
      )}

      <path
        className="chart-line"
        d={path(pts.map((p) => ({ age: p.ageMonths, value: p.value })))}
      />
      {pts.map((p) => {
        const selected = p.id === selectedId;
        const uncertain = p.readStatus === "UNCERTAIN";
        const label = `${formatKoDate(p.date)}, ${String(p.ageMonths)}개월, ${withUnit(p.value, measure)}${uncertain ? ", 판독 불확실" : ""}`;
        return (
          <g
            key={p.id}
            className="chart-point"
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            data-selected={selected ? "true" : undefined}
            transform={`translate(${xs(p.ageMonths).toFixed(1)} ${ysc(p.value).toFixed(1)})`}
            onClick={() => {
              onSelect(p.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.id);
              }
            }}
          >
            <circle className="chart-hit" r={HIT_R} />
            {selected ? <circle className="chart-ring" r={10} /> : null}
            <circle className={uncertain ? "chart-dot chart-dot-open" : "chart-dot"} r={5.5} />
          </g>
        );
      })}
    </svg>
  );
}
