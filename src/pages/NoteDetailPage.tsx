import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QueryError } from "../components/QueryError";
import { ArrowLeftIcon } from "../components/notesIcons";
import { ageLabel, formatDateKo, formatShortKo, timeKo } from "../lib/dateFormat";
import { segmentsByTerm } from "../lib/highlight";
import { useNoteDay } from "../lib/notesApi";
import type { NoteReport } from "../lib/notesSchemas";
import "../styles/notes.css";

// S31 알림장 상세. 이전/다음 날은 history 를 쌓지 않는다(replace): 뒤로 가기 한 번이면 목록(위치 복원)으로 돌아간다.

function Text({ text, term }: { text: string; term: string }) {
  return (
    <>
      {segmentsByTerm(text, term).map((s, i) =>
        s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

const countHits = (text: string, term: string): number =>
  segmentsByTerm(text, term).filter((s) => s.hit).length;

const WHO = { teacher: "교사", parent: "보호자" } as const;

function Report({
  report,
  term,
  order,
}: {
  report: NoteReport;
  term: string;
  /** 같은 날 알림장이 여러 건일 때 몇 번째인지(한 건이면 null) */
  order: number | null;
}) {
  const base = report.direction === "to_home" ? "알림장" : "집에서 보낸 글";
  const title = order === null ? base : `${base} ${String(order)}`;
  const meta = [timeKo(report.postedAt), report.authorRole, report.weather ?? ""]
    .filter((s) => s !== "")
    .join(" · ");
  return (
    <article className="card note-report" aria-label={title}>
      <h2>{title}</h2>
      <p className="meta">{meta}</p>
      {report.body === "" ? (
        <p className="note-text is-empty">본문이 비어 있어요.</p>
      ) : (
        <p className="note-text">
          <Text text={report.body} term={term} />
        </p>
      )}
      {report.comments.length > 0 && (
        <>
          <h3 className="sr-only">댓글 {String(report.comments.length)}개</h3>
          <ul className="note-comments">
            {report.comments.map((c) => (
              <li key={c.id} className="note-comment" data-who={c.who}>
                <p className="note-comment-head">
                  <span className="note-who">{WHO[c.who]}</span>
                  <span className="meta">{timeKo(c.postedAt)}</span>
                </p>
                <p className="note-text">
                  <Text text={c.body} term={term} />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

export default function NoteDetailPage() {
  const { date = "" } = useParams();
  const [sp] = useSearchParams();
  const term = sp.get("q") ?? "";
  const location = useLocation();
  const navigate = useNavigate();
  const query = useNoteDay(date);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [date]);

  const fromList = (location.state as { fromList?: boolean } | null)?.fromList === true;
  const qs = term !== "" ? `?q=${encodeURIComponent(term)}` : "";

  const back = (
    <div className="detail-top">
      {fromList ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigate(-1);
          }}
        >
          <ArrowLeftIcon />
          알림장 목록
        </button>
      ) : (
        <Link to="/notes" className="btn">
          <ArrowLeftIcon />
          알림장 목록
        </Link>
      )}
    </div>
  );

  if (query.isPending) {
    return (
      <>
        {back}
        <p className="loading" role="status">
          불러오는 중
        </p>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {back}
        <QueryError
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </>
    );
  }

  const day = query.data;
  const hits = day.items.reduce(
    (n, r) =>
      n + countHits(r.body, term) + r.comments.reduce((m, c) => m + countHits(c.body, term), 0),
    0,
  );

  const nav = (label: string) => (
    <nav className="day-nav" aria-label={label}>
      {day.prev ? (
        <Link to={`/notes/${day.prev}${qs}`} replace state={{ fromList }} className="btn">
          이전 날<small>{formatShortKo(day.prev)}</small>
        </Link>
      ) : (
        <button type="button" className="btn" disabled>
          이전 날<small>없어요</small>
        </button>
      )}
      {day.next ? (
        <Link to={`/notes/${day.next}${qs}`} replace state={{ fromList }} className="btn">
          다음 날<small>{formatShortKo(day.next)}</small>
        </Link>
      ) : (
        <button type="button" className="btn" disabled>
          다음 날<small>없어요</small>
        </button>
      )}
    </nav>
  );

  return (
    <>
      {back}
      <h1>{formatDateKo(day.date)}</h1>
      <p className="detail-meta">
        {ageLabel(day.ageMonths)} · {day.class}
      </p>
      {term !== "" && (
        <p className="status-line" role="status">
          「{term}」 {hits > 0 ? `${String(hits)}곳` : "일치 없음"}
        </p>
      )}
      {nav("이전·다음 날 (위)")}
      {day.items.map((r) => {
        const same = day.items.filter((x) => x.direction === r.direction);
        const order = same.length > 1 ? same.indexOf(r) + 1 : null;
        return <Report key={r.reportId} report={r} term={term} order={order} />;
      })}
      {nav("이전·다음 날 (아래)")}
    </>
  );
}
