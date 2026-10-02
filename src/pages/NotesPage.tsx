import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryError } from "../components/QueryError";
import { NoteRow } from "../components/NoteRow";
import { ClearIcon, SearchIcon } from "../components/notesIcons";
import { ThemeDecor } from "../components/decor/ThemeDecor";
import {
  MONTH_RE,
  minusMonths,
  monthEnd,
  monthLabelKo,
  monthLabelOf,
  monthsDesc,
} from "../lib/dateFormat";
import { useNotesList, useOverview } from "../lib/notesApi";
import { NOTES_QUERY_MAX, type NoteListItem } from "../lib/notesSchemas";
import "../styles/notes.css";

// S30 알림장 검색. 검색어·기간·월은 주소(?q=&p=&m=)에 둔다: 상세에서 뒤로 오면 같은 목록이 돌아온다.
// 「더 보기」 단추를 쓴다(무한 스크롤 아님): 조부모가 끝까지 내려가도 갑자기 길이가 바뀌지 않고, 탭바에 닿는다.

const PERIODS = [
  { id: "1m", label: "최근 1달", months: 1 },
  { id: "3m", label: "최근 3달", months: 3 },
  { id: "all", label: "전체", months: 0 },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

const SCROLL_KEY = "yj.notes.scroll";
const DEBOUNCE_MS = 300;

const parseMonth = (v: string | null): string => (v !== null && MONTH_RE.test(v) ? v : "");
const parsePeriod = (v: string | null): PeriodId => PERIODS.find((p) => p.id === v)?.id ?? "all";

function groupByMonth(items: NoteListItem[]): { label: string; items: NoteListItem[] }[] {
  const groups: { label: string; items: NoteListItem[] }[] = [];
  for (const item of items) {
    const label = monthLabelKo(item.date);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export default function NotesPage() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const month = parseMonth(sp.get("m"));
  const period = month !== "" ? "all" : parsePeriod(sp.get("p"));
  const [input, setInput] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (changes: { q?: string; p?: PeriodId; m?: string }) => {
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (changes.q !== undefined) {
          if (changes.q === "") next.delete("q");
          else next.set("q", changes.q);
        }
        if (changes.p !== undefined) {
          if (changes.p === "all") next.delete("p");
          else next.set("p", changes.p);
          next.delete("m");
        }
        if (changes.m !== undefined) {
          if (changes.m === "") next.delete("m");
          else {
            next.set("m", changes.m);
            next.delete("p");
          }
        }
        return next;
      },
      { replace: true },
    );
  };

  // 입력 후 300ms 가 지나면 검색어를 주소에 반영한다.
  useEffect(() => {
    const term = input.trim();
    if (term === q) return;
    const t = setTimeout(() => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (term === "") next.delete("q");
          else next.set("q", term);
          return next;
        },
        { replace: true },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [input, q, setSp]);

  // "최근 N달" 은 가장 최근 알림장 날짜를 기준으로 센다(동기화가 늦어져도 빈 목록이 되지 않게).
  const overview = useOverview();
  const months = PERIODS.find((p) => p.id === period)?.months ?? 0;
  const anchor = overview.data?.range?.to ?? null;
  const from = months > 0 && anchor ? minusMonths(anchor, months) : null;
  const ready = months === 0 || !overview.isPending;
  const to = month !== "" ? monthEnd(month) : null;
  const list = useNotesList({ q, from, to }, ready);
  const range = overview.data?.range ?? null;
  const monthOptions = useMemo(() => (range ? monthsDesc(range.from, range.to) : []), [range]);

  const nextFailed = list.isFetchNextPageError;
  const listError: unknown = list.error;
  const fetchNext = list.fetchNextPage;
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const groups = useMemo(() => groupByMonth(items), [items]);

  // 상세에서 돌아왔을 때 스크롤 위치 복원(한 번만).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !list.isSuccess) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "null") as {
        key: string;
        y: number;
      } | null;
      sessionStorage.removeItem(SCROLL_KEY);
      if (saved?.key === sp.toString() && saved.y > 0) window.scrollTo(0, saved.y);
    } catch {
      /* 저장값이 깨졌으면 맨 위에서 시작 */
    }
  }, [list.isSuccess, sp]);

  const rememberScroll = () => {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ key: sp.toString(), y: window.scrollY }));
  };

  const clear = () => {
    setInput("");
    update({ q: "" });
    inputRef.current?.focus();
  };

  return (
    <>
      <h1>알림장</h1>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: input.trim() });
        }}
      >
        <label className="sr-only" htmlFor="notes-q">
          알림장 검색
        </label>
        <div className="search-box">
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            id="notes-q"
            className="field"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={NOTES_QUERY_MAX}
            placeholder="본문·댓글에서 찾기"
            aria-describedby="notes-q-hint"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
          />
          {input !== "" && (
            <button
              type="button"
              className="search-clear"
              aria-label="검색어 지우기"
              onClick={clear}
            >
              <ClearIcon />
            </button>
          )}
        </div>
        <p className="sr-only" id="notes-q-hint">
          본문과 댓글에서 찾아요. 최대 {String(NOTES_QUERY_MAX)}자.
        </p>
      </form>

      <div className="filter-row">
        <div>
          <label className="sr-only" htmlFor="notes-period">
            기간
          </label>
          <select
            id="notes-period"
            className="field"
            value={period}
            onChange={(e) => {
              update({ p: parsePeriod(e.target.value) });
            }}
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {monthOptions.length > 1 && (
          <div>
            <label className="sr-only" htmlFor="notes-month">
              월로 바로 가기
            </label>
            <select
              id="notes-month"
              className="field"
              value={month}
              onChange={(e) => {
                update({ m: e.target.value });
              }}
            >
              <option value="">월 선택</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLabelOf(m)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {list.isPending ? (
        <p className="loading" role="status">
          불러오는 중
        </p>
      ) : list.isError ? (
        <QueryError
          error={list.error}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : items.length === 0 ? (
        <div className="empty" role="status">
          <ThemeDecor slot="empty" variant="notes" />
          {q !== "" ? (
            <p>「{q}」가 들어간 알림장이 없어요.</p>
          ) : (
            <p>
              {month !== ""
                ? `${monthLabelOf(month)} 이전에는 알림장이 없어요.`
                : "이 기간에는 알림장이 없어요."}
            </p>
          )}
          {period !== "all" || month !== "" ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                update({ p: "all" });
              }}
            >
              전체 기간으로 볼게요
            </button>
          ) : (
            q !== "" && <p>다른 낱말로 찾아 보세요.</p>
          )}
        </div>
      ) : (
        <>
          <p className="status-line" role="status">
            {q !== "" ? `「${q}」 ` : ""}
            {month !== "" ? `${monthLabelOf(month)}부터 ` : ""}
            {String(items.length)}일{list.hasNextPage ? " 보는 중" : ""}
          </p>
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="month-head">{g.label}</h2>
              <ul className="note-list">
                {g.items.map((item) => (
                  <li key={item.date}>
                    <NoteRow item={item} term={q} onOpen={rememberScroll} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {nextFailed && (
            <QueryError
              error={listError}
              onRetry={() => {
                void fetchNext();
              }}
            />
          )}
          {list.hasNextPage && (
            <div className="more-wrap">
              <button
                type="button"
                className="btn"
                disabled={list.isFetchingNextPage}
                onClick={() => {
                  void fetchNext();
                }}
              >
                {list.isFetchingNextPage ? "불러오는 중" : "더 보기"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
