import { Link } from "react-router-dom";
import { ageLabel, formatShortKo } from "../lib/dateFormat";
import { segmentsByRanges, segmentsByTerm, type Segment } from "../lib/highlight";
import type { NoteHit } from "../lib/notesSchemas";
import { ChevronRightIcon } from "./notesIcons";

export interface NoteRowData {
  date: string;
  ageMonths: number;
  firstLine: string;
  nComments: number;
  nReports?: number;
  hit?: NoteHit | undefined;
}

function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

/** 알림장 한 줄(목록·홈 공용): 날짜+요일, 나이, 첫 줄, 일치 발췌, 댓글 수. 누르면 그날 상세. */
export function NoteRow({
  item,
  term = "",
  onOpen,
}: {
  item: NoteRowData;
  term?: string;
  onOpen?: () => void;
}) {
  const qs = term !== "" ? `?q=${encodeURIComponent(term)}` : "";
  const first = item.firstLine;
  const hit = item.hit;
  // 일치가 있으면 발췌를 항상 보인다(첫 줄이 길면 일치 부분이 잘려 안 보일 수 있다). 첫 줄은 한 줄로 줄인다.
  const showExcerpt = hit !== undefined;
  return (
    <Link
      to={`/notes/${item.date}${qs}`}
      state={{ fromList: true }}
      className="note-row"
      onClick={onOpen}
    >
      <div className="note-row-main">
        <div className="note-row-top">
          <span className="note-date">{formatShortKo(item.date)}</span>
          <span className="meta">{ageLabel(item.ageMonths)}</span>
          {item.nReports !== undefined && item.nReports > 1 && (
            <span className="meta">{String(item.nReports)}건</span>
          )}
          <span className="meta">댓글 {String(item.nComments)}</span>
        </div>
        {first === "" ? (
          <p className="note-first is-empty">본문 없음</p>
        ) : (
          <p className={showExcerpt ? "note-first is-compact" : "note-first"}>
            <Marked segments={segmentsByTerm(first, term)} />
          </p>
        )}
        {showExcerpt && (
          <p className="note-hit">
            <span className="note-src">{hit.source === "comment" ? "댓글" : "본문"}</span>
            {hit.cutStart && "…"}
            <Marked segments={segmentsByRanges(hit.text, hit.ranges)} />
            {hit.cutEnd && "…"}
          </p>
        )}
      </div>
      <span className="note-chevron">
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
