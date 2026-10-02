// S43 성장 곡선: 측정 종류 탭 + SVG 차트(점 선택 → 값·날짜·측정 조건) + 표 보기 대체.
import { useState } from "react";
import { Link } from "react-router-dom";
import "./library.css";
import { Chip } from "../../components/Chip";
import { useGrowth, type Growth, type GrowthPoint, type Measure } from "./api";
import { refAt } from "./chart";
import { formatKoDate, MEASURES, measureInfo, withUnit } from "./format";
import { GrowthChart, plottable } from "./GrowthChart";
import { LoadError } from "./LoadError";
import { ScrollRegion } from "./ScrollRegion";

function status(p: GrowthPoint): string {
  return p.readStatus === "UNCERTAIN" ? "판독 불확실" : "확인";
}

function PointDetail({ p, measure }: { p: GrowthPoint; measure: Measure }) {
  return (
    <div className="card" aria-live="polite">
      <h2 className="card-title">{formatKoDate(p.date)}</h2>
      <dl className="kv">
        <dt>{measureInfo(measure).label}</dt>
        <dd>{withUnit(p.value, measure)}</dd>
        <dt>나이</dt>
        <dd>{p.ageMonths === null ? "알 수 없음" : `${String(p.ageMonths)}개월`}</dd>
        <dt>결과지 백분위</dt>
        <dd>{p.sheetPct === null ? "없음" : String(p.sheetPct)}</dd>
        {p.recalcPct !== null ? (
          <>
            <dt>기준표로 다시 계산</dt>
            <dd>{p.recalcPct}</dd>
          </>
        ) : null}
        <dt>판독</dt>
        <dd>
          {p.readStatus === "UNCERTAIN" ? (
            <span className="badge" data-status="uncertain">
              판독 불확실
            </span>
          ) : (
            status(p)
          )}
        </dd>
        <dt>측정 조건</dt>
        <dd>{p.note ?? "적어 둔 메모 없음"}</dd>
      </dl>
    </div>
  );
}

function GrowthTable({ data, measure }: { data: Growth; measure: Measure }) {
  const info = measureInfo(measure);
  const showRecalc = data.points.some((p) => p.recalcPct !== null);
  const refCell = (p: GrowthPoint, key: "p3" | "p50" | "p97") => {
    const v = p.ageMonths === null ? null : refAt(data.reference, key, p.ageMonths);
    return v === null ? "없음" : String(Math.round(v * 10) / 10);
  };
  return (
    <ScrollRegion label={`${info.label} 기록 표`}>
      <table className="data-table">
        <caption>{info.unit ? `${info.label} (${info.unit})` : info.label}</caption>
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col">나이(개월)</th>
            <th scope="col">값</th>
            <th scope="col">결과지 백분위</th>
            {showRecalc ? <th scope="col">다시 계산</th> : null}
            <th scope="col">판독</th>
            <th scope="col">측정 조건</th>
            <th scope="col">기준 3%</th>
            <th scope="col">기준 50%</th>
            <th scope="col">기준 97%</th>
          </tr>
        </thead>
        <tbody>
          {data.points.map((p) => (
            <tr key={p.id}>
              <th scope="row">{formatKoDate(p.date)}</th>
              <td>{p.ageMonths ?? "없음"}</td>
              <td>{p.value}</td>
              <td>{p.sheetPct ?? "없음"}</td>
              {showRecalc ? <td>{p.recalcPct ?? "없음"}</td> : null}
              <td>{status(p)}</td>
              <td>{p.note ?? "없음"}</td>
              <td>{refCell(p, "p3")}</td>
              <td>{refCell(p, "p50")}</td>
              <td>{refCell(p, "p97")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export default function GrowthPage() {
  const [measure, setMeasure] = useState<Measure>("height_cm");
  const [asTable, setAsTable] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const q = useGrowth(measure);
  // 점이 하나뿐이면 누르지 않아도 값과 측정 조건을 바로 보여 준다.
  const only = q.data?.points.length === 1 ? (q.data.points[0] ?? null) : null;
  const selected = q.data?.points.find((p) => p.id === selectedId) ?? only;
  const drawn = q.data ? plottable(q.data.points).length : 0;
  const anyUncertain = q.data?.points.some((p) => p.readStatus === "UNCERTAIN") ?? false;

  return (
    <>
      <Link to="/library" className="link">
        ← 자료
      </Link>
      <h1>성장 곡선</h1>

      <div className="chip-row" role="group" aria-label="측정 종류">
        {MEASURES.map((m) => (
          <Chip
            key={m.id}
            pressed={measure === m.id}
            onPress={() => {
              setMeasure(m.id);
              setSelectedId(null);
            }}
          >
            {m.label}
          </Chip>
        ))}
      </div>

      <div className="growth-body" data-tone="serious">
        {q.isPending ? (
          <p className="loading" role="status">
            불러오는 중
          </p>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.points.length === 0 ? (
          <p className="muted">
            {measureInfo(measure).label} 측정값이 아직 없어요.
            <br />
            검진 결과가 적재되면 여기에 나타나요.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAsTable((v) => !v);
              }}
            >
              {asTable ? "그래프로 보기" : "표로 보기"}
            </button>

            {asTable ? (
              <GrowthTable data={q.data} measure={measure} />
            ) : (
              <>
                {drawn > 0 ? (
                  <GrowthChart
                    data={q.data}
                    measure={measure}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ) : (
                  <p className="muted">
                    나이를 알 수 없어 그래프에 그릴 수 없어요.
                    <br />
                    표로 볼 수 있어요.
                  </p>
                )}
                <ul className="chart-legend">
                  <li>
                    <span className="legend-line legend-edge" aria-hidden="true" /> 옅은 점선: 기준
                    곡선 3%, 97%
                  </li>
                  <li>
                    <span className="legend-line legend-mid" aria-hidden="true" /> 옅은 실선: 기준
                    곡선 50%
                  </li>
                  <li>
                    <span className="legend-dot" aria-hidden="true" />{" "}
                    {anyUncertain ? "진한 점: 측정값, 빈 점: 판독 불확실" : "점: 측정값"}
                  </li>
                  {q.data.referenceSource ? <li>기준표 출처: {q.data.referenceSource}</li> : null}
                </ul>
                {only ? (
                  <p className="muted">
                    측정이 한 번뿐이라 점이 하나예요.
                    <br />
                    검진이 쌓이면 선으로 이어져요.
                  </p>
                ) : null}
                {selected ? (
                  <PointDetail p={selected} measure={measure} />
                ) : drawn > 0 ? (
                  <p className="muted">점을 누르면 값과 측정 조건을 볼 수 있어요.</p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
