import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnswerCard } from "../components/ask/AnswerCard";
import { RedFlagCard } from "../components/ask/RedFlagCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CheckIcon } from "../components/icons";
import { Notice } from "../components/Notice";
import { QueryError } from "../components/QueryError";
import {
  useAskDetail,
  useAskFeedback,
  useDeleteAsk,
  useInstant,
  type AskDetail,
} from "../lib/ask/api";
import { COPY } from "../lib/ask/copy";
import { STATUS_LINE, STEPS, stepIndex, whenKo } from "../lib/ask/format";
import { formatShortKo } from "../lib/dateFormat";
import { getDefaultRecorder } from "../lib/logs/ids";
import { useOverview } from "../lib/notesApi";
import "../styles/notes.css";
import "../styles/ask.css";

function Progress({ status }: { status: AskDetail["status"] }) {
  const at = stepIndex(status);
  return (
    <>
      <ol className="ask-progress" aria-label="진행 단계">
        {STEPS.map((label, i) => (
          <li
            key={label}
            data-state={i < at || status === "done" ? "done" : i === at ? "now" : "next"}
            aria-current={i === at && status !== "done" ? "step" : undefined}
          >
            {i < at || status === "done" ? (
              <CheckIcon size={16} />
            ) : (
              <span aria-hidden="true">{i + 1}</span>
            )}
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="ask-status-line">
        {STATUS_LINE[status]}
      </p>
    </>
  );
}

function Instant({ id }: { id: number }) {
  const q = useInstant(id);
  if (q.isPending) return null;
  if (q.isError) return null;
  const { notes, docs } = q.data;
  return (
    <section aria-labelledby="ask-instant">
      <h2 id="ask-instant">비슷한 알림장·자료</h2>
      {notes.length === 0 && docs.length === 0 ? (
        <p className="meta">{COPY.noInstant}</p>
      ) : (
        <div className="card">
          {notes.map((n) => (
            <Link key={n.id} to={`/notes/${n.date}`} className="list-row ask-hit">
              <span>
                <span className="meta">{formatShortKo(n.date)}</span>
                <br />
                {n.snippet}
              </span>
            </Link>
          ))}
          {docs.map((d) => (
            <Link key={d.slug} to={`/library/doc/${d.slug}`} className="list-row ask-hit">
              <span>
                <span className="meta">자료</span>
                <br />
                {d.title}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Feedback({ detail }: { detail: AskDetail }) {
  const id = detail.question.id;
  const send = useAskFeedback(id);
  const by = getDefaultRecorder() ?? "가족";
  const [note, setNote] = useState("");
  return (
    <section aria-labelledby="ask-feedback">
      <h2 id="ask-feedback">의견</h2>
      <div className="chip-row">
        <button
          type="button"
          className="btn"
          disabled={send.isPending}
          onClick={() => {
            send.mutate({ by, helpful: true });
          }}
        >
          도움이 됐어요
        </button>
        <button
          type="button"
          className="btn"
          disabled={send.isPending}
          onClick={() => {
            send.mutate({ by, helpful: false });
          }}
        >
          도움이 안 됐어요
        </button>
      </div>
      <div className="field-row">
        <label htmlFor="ask-note" className="ask-field-label">
          {COPY.noteLabel}
        </label>
        <textarea
          id="ask-note"
          className="field field-area"
          rows={3}
          maxLength={500}
          placeholder={COPY.noteHint}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={send.isPending || note.trim() === ""}
          onClick={() => {
            send.mutate(
              { by, note: note.trim() },
              {
                onSuccess: () => {
                  setNote("");
                },
              },
            );
          }}
        >
          메모 남기기
        </button>
      </div>
      {send.isError && (
        <div role="alert">
          <Notice tone="warn">{COPY.noteFail}</Notice>
        </div>
      )}
      {detail.feedback.length > 0 && (
        <div className="card">
          {detail.feedback.map((f) => (
            <div className="list-row" key={f.id}>
              <span>
                <span className="meta">
                  {f.by} · {whenKo(f.createdAt)}
                </span>
                <br />
                {f.helpful === true && <strong>도움이 됐어요</strong>}
                {f.helpful === false && <strong>도움이 안 됐어요</strong>}
                {f.note ? <span className="ask-note">{f.note}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AskDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const id = /^\d{1,9}$/.test(params.id ?? "") ? Number(params.id) : null;
  const detail = useAskDetail(id);
  const overview = useOverview();
  const del = useDeleteAsk();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <h1>질문</h1>
      <p>
        <Link to="/ask" className="link">
          물어보기로 돌아가기
        </Link>
      </p>
      {id === null ? (
        <Notice tone="alert">{COPY.notFound}</Notice>
      ) : detail.isPending ? (
        <p className="loading" role="status">
          불러오는 중
        </p>
      ) : detail.isError ? (
        <QueryError
          error={detail.error}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      ) : (
        <Body
          detail={detail.data}
          workerOffline={overview.data ? !overview.data.ask.worker.online : false}
          onDelete={() => {
            setAsking(true);
          }}
        />
      )}
      <ConfirmDialog
        open={asking}
        title="이 질문을 지울까요?"
        confirmLabel="지우기"
        busy={del.isPending}
        onCancel={() => {
          setAsking(false);
          del.reset();
        }}
        onConfirm={() => {
          if (id === null) return;
          del.mutate(id, {
            onSuccess: () => {
              setAsking(false);
              void navigate("/ask");
            },
          });
        }}
      >
        <p>{COPY.delNote}</p>
        {del.isError && <p className="field-error">{COPY.delFail}</p>}
      </ConfirmDialog>
    </>
  );
}

function Body({
  detail,
  workerOffline,
  onDelete,
}: {
  detail: AskDetail;
  workerOffline: boolean;
  onDelete: () => void;
}) {
  const { question, status } = detail;
  const waiting = status === "pending" || status === "claimed";
  return (
    <>
      {detail.redFlag && <RedFlagCard />}
      <section aria-labelledby="ask-q">
        <h2 id="ask-q">질문</h2>
        <div className="card">
          <p className="meta">
            {question.askedBy} · {whenKo(question.createdAt)}
          </p>
          <p className="ask-question">{question.body}</p>
        </div>
      </section>

      {status !== "done" && (
        <section aria-labelledby="ask-progress">
          <h2 id="ask-progress">진행 상황</h2>
          <Progress status={status} />
          {waiting && workerOffline && (
            <Notice tone="info">
              <span>{COPY.offWait}</span>
            </Notice>
          )}
          {status === "failed" && (
            <>
              <Notice tone="alert">
                <span>{COPY.fail1}</span> <span>{COPY.fail2}</span>
              </Notice>
              <p>
                <Link to="/ask" className="btn">
                  새로 질문하기
                </Link>
              </p>
            </>
          )}
        </section>
      )}

      <Instant id={question.id} />

      {status === "done" && (
        <section aria-labelledby="ask-answer">
          <h2 id="ask-answer">답변</h2>
          {detail.answer ? (
            <AnswerCard
              level={detail.answer.level}
              answer={detail.answer.answer}
              reviewScore={detail.answer.reviewScore}
            />
          ) : (
            <Notice tone="warn">{COPY.noAnswer}</Notice>
          )}
        </section>
      )}

      {status === "done" && <Feedback detail={detail} />}

      <p>
        <button type="button" className="btn" onClick={onDelete}>
          질문 지우기
        </button>
      </p>
    </>
  );
}
