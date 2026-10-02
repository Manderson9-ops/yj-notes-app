// S40 자료실: 건강 기록 입구(검진·성장) + 문서 카드(보고서·가이드·위키 묶음).
import { Link } from "react-router-dom";
import "./library.css";
import { useCheckups, useReports, type ReportMeta } from "./api";
import { formatKoDate } from "./format";
import { LoadError } from "./LoadError";
import { VerifyBadge } from "./VerifyBadge";

const GROUPS: { id: ReportMeta["group"]; title: string }[] = [
  { id: "report", title: "보고서" },
  { id: "guide", title: "가이드" },
  { id: "wiki", title: "위키" },
];

export default function LibraryPage() {
  const reports = useReports();
  const checkups = useCheckups();

  return (
    <>
      <h1>자료</h1>

      <section aria-labelledby="lib-health">
        <h2 id="lib-health">건강 기록</h2>
        <div className="card-stack">
          <Link to="/library/checkups" className="card doc-card">
            <strong className="doc-title">검진 결과</strong>
            <span className="meta">
              {checkups.data
                ? `검진 ${String(checkups.data.items.length)}건`
                : "결과지 그대로 보기"}
            </span>
          </Link>
          <Link to="/library/growth" className="card doc-card">
            <strong className="doc-title">성장 곡선</strong>
            <span className="meta">키 · 몸무게 · 머리둘레 · BMI</span>
          </Link>
        </div>
      </section>

      {reports.isPending ? (
        <p className="loading" role="status">
          불러오는 중
        </p>
      ) : reports.isError ? (
        <>
          <h2>문서</h2>
          <LoadError error={reports.error} onRetry={() => void reports.refetch()} />
        </>
      ) : reports.data.items.length === 0 ? (
        <>
          <h2>문서</h2>
          <p className="muted">
            아직 올라온 문서가 없어요.
            <br />
            자료가 적재되면 여기에 나타나요.
          </p>
        </>
      ) : (
        GROUPS.map((g) => {
          const docs = reports.data.items.filter((d) => d.group === g.id);
          if (docs.length === 0) return null;
          return (
            <section key={g.id} aria-labelledby={`lib-${g.id}`}>
              <h2 id={`lib-${g.id}`}>{g.title}</h2>
              <div className="card-stack">
                {docs.map((d) => (
                  <Link key={d.slug} to={`/library/doc/${d.slug}`} className="card doc-card">
                    <strong className="doc-title">{d.title}</strong>
                    <span className="meta">{formatKoDate(d.generatedAt)}</span>
                    <VerifyBadge doc={d} />
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
