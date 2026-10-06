import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnswerCard } from "../components/ask/AnswerCard";
import { ShareBar } from "../components/ask/ShareBar";
import { VoteBar } from "../components/ask/VoteBar";
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
import type { ShareMode } from "../lib/ask/share";
import { STATUS_LINE, STEPS, stepIndex, whenKo } from "../lib/ask/format";
import { formatShortKo } from "../lib/dateFormat";
import { getDefaultRecorder } from "../lib/logs/ids";
import { useOverview } from "../lib/notesApi";
import "../styles/notes.css";
import "../styles/ask.css";

/** 다시 답변 중이면 줄 문구를 「다시 작성」 쪽으로 바꾼다(단계 모양은 그대로). */
function lineOf(status: AskDetail["status"], reasking: boolean): string {
  if (!reasking) return STATUS_LINE[status];
  if (status === "reviewing") return COPY.reaskReview;
  if (status === "pending") return COPY.reaskPending;
  return `${COPY.reaskLine1} ${COPY.reaskLine2}`;
}

function Progress({ status, reasking }: { status: AskDetail["status"]; reasking: boolean }) {
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
            <span>{reasking && label === "작성 중" ? "다시 작성 중" : label}</span>
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite" className="ask-status-line">
        {lineOf(status, reasking)}
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

/** 해 봤어요 메모: 해 본 방법과 결과를 적으면 다음 답변에 반영돼요(도움 여부는 위 표). */
function Memo({ detail }: { detail: AskDetail }) {
  const id = detail.question.id;
  const send = useAskFeedback(id);
  const by = getDefaultRecorder() ?? "가족";
  const [note, setNote] = useState("");
  return (
    <section aria-labelledby="ask-feedback">
      <h2 id="ask-feedback">{COPY.noteLabel}</h2>
      <p className="meta" id="ask-note-guide">
        {COPY.noteGuide}
      </p>
      <div className="field-row">
        <label htmlFor="ask-note" className="sr-only">
          {COPY.noteLabel}
        </label>
        <textarea
          id="ask-note"
          aria-describedby="ask-note-guide"
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
                <span className="ask-note">{f.note}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 이전 답변(다시 답변 전의 답): 접어 둔다. */
function OldAnswers({ detail }: { detail: AskDetail }) {
  if (detail.history.length === 0) return null;
  return (
    <section aria-labelledby="ask-old">
      <h2 id="ask-old">{COPY.oldAnswers}</h2>
      {[...detail.history].reverse().map((h) => (
        <details key={h.version} className="ask-old">
          <summary>
            {COPY.oldAnswerN} {h.version} · {whenKo(h.createdAt)}
          </summary>
          <AnswerCard level={h.level ?? h.answer.level} answer={h.answer} />
        </details>
      ))}
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
  const reasking = detail.reask.count > 0 && status !== "done" && status !== "failed";
  const [mode, setMode] = useState<ShareMode>("summary");
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
          <Progress status={status} reasking={reasking} />
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
            <>
              <AnswerCard
                level={detail.answer.level ?? detail.answer.answer.level}
                answer={detail.answer.answer}
                reviewScore={detail.answer.reviewScore}
                afterSummary={<ShareBar detail={detail} mode={mode} onMode={setMode} where="top" />}
              />
              <ShareBar detail={detail} mode={mode} onMode={setMode} where="bottom" />
            </>
          ) : (
            <Notice tone="warn">{COPY.noAnswer}</Notice>
          )}
        </section>
      )}

      {status === "done" && <VoteBar detail={detail} />}
      {status === "done" && <Memo detail={detail} />}
      <OldAnswers detail={detail} />

      <p>
        <button type="button" className="btn" onClick={onDelete}>
          질문 지우기
        </button>
      </p>
    </>
  );
}
