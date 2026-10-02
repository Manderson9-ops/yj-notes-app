import { useState } from "react";
import { Link } from "react-router-dom";
import { Notice } from "../components/Notice";
import { NoteRow } from "../components/NoteRow";
import { QueryError } from "../components/QueryError";
import { ThemeDecor } from "../components/decor/ThemeDecor";
import { daysSince, formatDateKo } from "../lib/dateFormat";
import { useOverview } from "../lib/notesApi";
import "../styles/notes.css";

// S10 홈. 맨 위는 「오늘 기록하기」(화면은 기록 카드가 만든다), 아래는 사실 숫자만: 판정 문구 없음(P1).
// 14일 넘게 동기화가 없으면 주의색 안내(docs/06 §4).
const STALE_DAYS = 14;

const num = (n: number): string => n.toLocaleString("ko-KR");

export default function HomePage() {
  const overview = useOverview();

  return (
    <>
      <h1>홈</h1>
      <div className="home-actions">
        <Link to="/logs/new" className="btn-primary btn-lg">
          오늘 기록하기
        </Link>
      </div>

      {overview.isPending ? (
        <p className="loading" role="status">
          불러오는 중
        </p>
      ) : overview.isError ? (
        <QueryError
          error={overview.error}
          onRetry={() => {
            void overview.refetch();
          }}
        />
      ) : (
        <HomeBody data={overview.data} />
      )}
    </>
  );
}

function HomeBody({ data }: { data: NonNullable<ReturnType<typeof useOverview>["data"]> }) {
  const [now] = useState(() => Date.now());
  const staleDays = data.lastIngest ? daysSince(data.lastIngest.at, now) : null;
  const syncDate = data.lastIngest?.at.slice(0, 10);

  return (
    <>
      <section aria-labelledby="home-notes">
        <h2 id="home-notes">최근 알림장</h2>
        {data.recentNotes.length === 0 ? (
          <div className="empty">
            <ThemeDecor slot="empty" variant="home" />
            <p>아직 알림장이 없어요.</p>
          </div>
        ) : (
          <>
            <div className="card-stack">
              {data.recentNotes.map((n) => (
                <div className="card" key={n.date}>
                  <NoteRow item={n} />
                </div>
              ))}
            </div>
            <p>
              <Link to="/notes" className="link">
                알림장 전체 보기
              </Link>
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="home-sync" className="home-facts">
        <h2 id="home-sync">자료 현황</h2>
        {staleDays !== null && staleDays > STALE_DAYS && (
          <Notice tone="warn">마지막 동기화가 {String(staleDays)}일 전이에요.</Notice>
        )}
        <div className="card">
          <dl className="kv">
            <dt>마지막 동기화</dt>
            <dd>
              {data.lastIngest && syncDate
                ? `${formatDateKo(syncDate)} · ${staleDays === 0 ? "오늘" : `${String(staleDays)}일 전`}`
                : "아직 없어요"}
            </dd>
            <dt>알림장</dt>
            <dd>{num(data.noteDays)}일</dd>
            <dt>보고서</dt>
            <dd>{num(data.reports)}건</dd>
            <dt>댓글</dt>
            <dd>{num(data.comments)}개</dd>
            {data.range && (
              <>
                <dt>기간</dt>
                <dd>
                  {data.range.from} ~ {data.range.to}
                </dd>
              </>
            )}
          </dl>
        </div>
      </section>

      {data.recentLogs.length > 0 && (
        <section aria-labelledby="home-logs">
          <h2 id="home-logs">최근 가족 기록</h2>
          <div className="card">
            {data.recentLogs.map((l) => (
              <div className="list-row" key={l.id}>
                <span>
                  {l.typeLabel} · {l.recorder}
                </span>
                <span className="meta">{l.occurredOn}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
