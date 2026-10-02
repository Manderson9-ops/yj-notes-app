// S42 검진: 결과지 문구·백분위를 그대로 보여 준다(판정 문구를 만들지 않는다). 진지한 영역(data-tone="serious").
import { Fragment } from "react";
import { Link } from "react-router-dom";
import "./library.css";
import { Notice } from "../../components/Notice";
import { useCheckups, type Checkup } from "./api";
import { formatKoDate, measureInfo } from "./format";
import { LoadError } from "./LoadError";
import { ScrollRegion } from "./ScrollRegion";

function CheckupCard({ c }: { c: Checkup }) {
  const uncertain = c.measurements.some((m) => m.readStatus === "UNCERTAIN");
  const noted = c.measurements.filter((m) => m.note);
  return (
    <article className="card" aria-labelledby={`ck-${String(c.id)}`}>
      <h2 id={`ck-${String(c.id)}`} className="card-title">
        {c.roundLabel}
      </h2>
      <dl className="kv">
        <dt>검진일</dt>
        <dd>{formatKoDate(c.examDate)}</dd>
        <dt>나이</dt>
        <dd>{c.ageMonths}개월</dd>
        <dt>종합 소견</dt>
        <dd>{c.overall}</dd>
        {c.remarks ? (
          <>
            <dt>참고 사항</dt>
            <dd>{c.remarks}</dd>
          </>
        ) : null}
        <dt>발달 평가</dt>
        <dd>{c.devResult}</dd>
      </dl>
      <p className="meta source-note">결과지에 적힌 내용 그대로예요.</p>

      {c.measurements.length > 0 ? (
        <ScrollRegion label={`${c.roundLabel} 계측`}>
          <table className="data-table">
            <caption>계측</caption>
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">값</th>
                <th scope="col">결과지 백분위</th>
                {uncertain ? <th scope="col">판독</th> : null}
              </tr>
            </thead>
            <tbody>
              {c.measurements.map((m) => {
                const info = measureInfo(m.measure);
                return (
                  <tr key={m.id}>
                    <th scope="row">{info.label}</th>
                    <td className="num">
                      {info.unit ? `${String(m.value)} ${info.unit}` : String(m.value)}
                    </td>
                    <td>{m.sheetPct === null ? "없음" : String(m.sheetPct)}</td>
                    {uncertain ? (
                      <td>
                        {m.readStatus === "UNCERTAIN" ? (
                          <span className="badge" data-status="uncertain">
                            판독 불확실
                          </span>
                        ) : (
                          "확인"
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      ) : null}

      {noted.length > 0 ? (
        <section aria-labelledby={`ck-notes-${String(c.id)}`}>
          <h3 id={`ck-notes-${String(c.id)}`} className="card-subtitle">
            측정 조건 메모
          </h3>
          <dl className="kv">
            {noted.map((m) => (
              <Fragment key={m.id}>
                <dt>{measureInfo(m.measure).label}</dt>
                <dd>{m.note}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ) : null}

      {uncertain ? (
        <Notice tone="warn">
          판독 불확실 값은 실제와 다를 수 있어요.
          <br />
          원본 결과지와 맞춰 봐 주세요.
        </Notice>
      ) : null}
    </article>
  );
}

export default function CheckupsPage() {
  const q = useCheckups();
  return (
    <>
      <Link to="/library" className="link">
        ← 자료
      </Link>
      <h1>검진</h1>
      <div data-tone="serious">
        {q.isPending ? (
          <p className="loading" role="status">
            불러오는 중
          </p>
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <p className="muted">
            아직 올라온 검진 결과가 없어요.
            <br />
            결과지가 적재되면 여기에 나타나요.
          </p>
        ) : (
          <div className="card-stack">
            {q.data.items.map((c) => (
              <CheckupCard key={c.id} c={c} />
            ))}
            <Link to="/library/growth" className="btn">
              성장 곡선 보기
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
