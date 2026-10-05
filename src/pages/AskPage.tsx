import { useState, type SyntheticEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RedFlagCard } from "../components/ask/RedFlagCard";
import { LevelBadge } from "../components/ask/LevelBadge";
import { Chip } from "../components/Chip";
import { Notice } from "../components/Notice";
import { QueryError } from "../components/QueryError";
import { ApiError } from "../lib/api";
import { useAskList, useCreateAsk } from "../lib/ask/api";
import { COPY } from "../lib/ask/copy";
import { STATUS_LABEL, whenKo } from "../lib/ask/format";
import { RECORDERS, getDefaultRecorder, setDefaultRecorder } from "../lib/logs/ids";
import { useOverview } from "../lib/notesApi";
import { detectRedFlag } from "../../server/ask/redflags";
import "../styles/notes.css";
import "../styles/ask.css";

const BODY_MAX = 1000;

/** S50 물어보기: 질문 입력(위급 신호는 쓰는 즉시 경고) + 최근 질문 목록. */
export default function AskPage() {
  const navigate = useNavigate();
  const overview = useOverview();
  const create = useCreateAsk();
  const list = useAskList();
  const [recorder, setRecorder] = useState(() => getDefaultRecorder() ?? "");
  const [text, setText] = useState("");
  const red = detectRedFlag(text).redFlag;
  const canSend = recorder !== "" && text.trim() !== "" && !create.isPending;
  const worker = overview.data?.ask.worker;

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!canSend) return;
    create.mutate(
      { body: text.trim(), askedBy: recorder },
      {
        onSuccess: (res) => {
          setDefaultRecorder(recorder);
          void navigate(`/ask/${String(res.id)}`);
        },
      },
    );
  };

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <h1>물어보기</h1>
      <p className="muted">
        <span>{COPY.intro1}</span> <span>{COPY.intro2}</span>
      </p>

      {worker && !worker.online && (
        <Notice tone="info">
          <span>{COPY.off1}</span> <span>{COPY.off2}</span>
        </Notice>
      )}

      <form onSubmit={submit} aria-label="질문 쓰기">
        <p className="ask-field-label" id="ask-who">
          질문하는 사람
        </p>
        <div className="chip-row" role="group" aria-labelledby="ask-who">
          {RECORDERS.map((r) => (
            <Chip
              key={r}
              pressed={recorder === r}
              onPress={() => {
                setRecorder(r);
              }}
            >
              {r}
            </Chip>
          ))}
        </div>

        <div className="field-row">
          <label htmlFor="ask-body" className="ask-field-label">
            {COPY.bodyLabel}
          </label>
          <textarea
            id="ask-body"
            className="field field-area ask-body"
            rows={5}
            maxLength={BODY_MAX}
            placeholder={COPY.bodyHint}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <p className="meta" aria-hidden="true">
            {text.length} / {BODY_MAX}
          </p>
        </div>

        {red && <RedFlagCard />}

        {create.isError && (
          <div role="alert">
            <Notice tone="warn">
              {create.error instanceof ApiError && create.error.status === 429 ? (
                <>
                  <span>{COPY.many1}</span> <span>{COPY.many2}</span>
                </>
              ) : (
                COPY.sendFail
              )}
            </Notice>
          </div>
        )}
        {recorder === "" && <p className="meta">{COPY.pickWho}</p>}
        <button type="submit" className="btn-primary btn-lg ask-send" disabled={!canSend}>
          {create.isPending ? "보내는 중" : "보내기"}
        </button>
      </form>

      <section aria-labelledby="ask-recent">
        <h2 id="ask-recent">최근 질문</h2>
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
          <div className="empty">
            <p>{COPY.none}</p>
          </div>
        ) : (
          <div className="card-stack">
            {items.map((q) => (
              <Link key={q.id} to={`/ask/${String(q.id)}`} className="card ask-row">
                <p className="meta">
                  {q.askedBy} · {whenKo(q.createdAt)}
                </p>
                <p className="ask-preview">{q.bodyPreview}</p>
                <p className="ask-row-state">
                  <span className="badge">{STATUS_LABEL[q.status]}</span>
                  {q.level !== undefined && <LevelBadge level={q.level} compact />}
                  {q.redFlag && <span className="badge">{COPY.redBadge}</span>}
                </p>
              </Link>
            ))}
          </div>
        )}
        {list.hasNextPage && (
          <button
            type="button"
            className="btn"
            disabled={list.isFetchingNextPage}
            onClick={() => {
              void list.fetchNextPage();
            }}
          >
            더 보기
          </button>
        )}
      </section>
    </>
  );
}
