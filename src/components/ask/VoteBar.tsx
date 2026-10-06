// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts). 제목·버튼 글자는 lib/ask/labels.ts 에 있다.
import { useState } from "react";
import {
  ASK_REASK_MAX,
  ASK_REASK_TEXT_MAX,
  ASK_VOTE_REASON_MAX,
  REASK_CHOICES,
  joinReaskReason,
  splitReaskReason,
  type ReaskChoice,
} from "../../../shared/ask-schema";
import { useAskReask, useAskVote, type AskDetail, type AskVoteItem } from "../../lib/ask/api";
import { COPY } from "../../lib/ask/copy";
import { reaskLeftLine } from "../../lib/ask/format";
import { LABELS } from "../../lib/ask/labels";
import { getDefaultRecorder } from "../../lib/logs/ids";
import { Chip } from "../Chip";
import { ChipRadioGroup } from "../ChipRadioGroup";
import { Notice } from "../Notice";

/** 지금 답에 대한 표만(다시 답변 전의 표는 이전 답에 대한 것이라 뺀다). */
export function currentVotes(detail: AskDetail): AskVoteItem[] {
  const since = detail.answer?.createdAt;
  if (detail.history.length === 0 || since === undefined) return detail.votes;
  return detail.votes.filter((v) => v.updatedAt >= since);
}

/** 「가족 의견: 엄마 👍 (내 표) · 할머니 👎」: 이모지는 보조고 글로도 읽힌다. */
export function VoteSummary({ votes, me }: { votes: readonly AskVoteItem[]; me: string }) {
  if (votes.length === 0) return null;
  return (
    <p className="ask-vote-summary" data-testid="ask-vote-summary">
      <span>{COPY.voteLine}</span>{" "}
      {votes.map((v, i) => (
        <span key={v.by}>
          {i > 0 ? " · " : ""}
          {v.by} <span aria-hidden="true">{v.helpful ? "👍" : "👎"}</span>
          <span className="sr-only">{v.helpful ? COPY.voteUp : COPY.voteDown}</span>
          {v.by === me ? <span className="ask-mine"> ({COPY.voteMine})</span> : null}
        </span>
      ))}
    </p>
  );
}

type Notice3 = "saved" | "down" | "cleared" | null;

/**
 * 표(도움이 됐어요/안 됐어요): 선택은 테두리 + 굵게 + 체크 아이콘 + aria-pressed(공용 Chip). 같은 쪽을 다시 누르면 취소,
 * 다른 쪽을 누르면 바꾸기. 👎 를 누르면 이유를 고르고 「다시 답변 받기」(질문당 3회) 또는 이유만 저장.
 * onReasked: 다시 답변을 요청한 직후(포커스를 진행 상황으로 옮기고 알리는 일은 부모가 한다).
 */
export function VoteBar({ detail, onReasked }: { detail: AskDetail; onReasked: () => void }) {
  const id = detail.question.id;
  const by = getDefaultRecorder() ?? "가족";
  const vote = useAskVote(id);
  const reask = useAskReask(id);
  const votes = currentVotes(detail);
  const mine = votes.find((v) => v.by === by);
  const [notice, setNotice] = useState<Notice3>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ReaskChoice | null>(null);
  const [text, setText] = useState("");
  const left = Math.max(0, ASK_REASK_MAX - detail.reask.count);
  const down = mine?.helpful === false;
  // 👎 만 있고 이유가 아직 없으면 패널을 바로 연다. 이유가 있으면 링크 버튼으로 다시 연다.
  const autoOpen = mine?.helpful === false && mine.reason === null;
  const showPanel = down && (open || autoOpen);
  const noChoice = choice === null;

  const openPanel = () => {
    const prev = mine?.reason ? splitReaskReason(mine.reason) : null;
    setChoice(prev?.choice ?? null);
    setText(prev?.text ?? "");
    setOpen(true);
  };

  const press = (helpful: boolean) => {
    setNotice(null);
    if (mine?.helpful === helpful) {
      setOpen(false);
      vote.mutate(
        { by, helpful: null },
        {
          onSuccess: () => {
            setNotice("cleared");
          },
        },
      );
      return;
    }
    if (!helpful) {
      setChoice(null);
      setText("");
    }
    setOpen(!helpful);
    vote.mutate(
      { by, helpful },
      {
        onSuccess: () => {
          setNotice(helpful ? "saved" : "down");
        },
      },
    );
  };

  const reasonLine = (): string | undefined =>
    choice === null
      ? undefined
      : joinReaskReason(choice, text.trim() === "" ? undefined : text.trim()).slice(
          0,
          ASK_VOTE_REASON_MAX,
        );

  const keepReason = () => {
    const reason = reasonLine();
    if (reason === undefined) return;
    vote.mutate(
      { by, helpful: false, reason },
      {
        onSuccess: () => {
          setNotice("saved");
          setOpen(false);
        },
      },
    );
  };

  const askAgain = () => {
    if (choice === null) return;
    const reason = reasonLine();
    const t = text.trim();
    // 표의 이유를 먼저 남기고(끝난 질문에만 표를 받는다) 다시 답변을 요청한다.
    vote.mutate(
      { by, helpful: false, ...(reason === undefined ? {} : { reason }) },
      {
        onSuccess: () => {
          reask.mutate(
            { by, choice, ...(t === "" ? {} : { text: t }) },
            {
              onSuccess: () => {
                onReasked();
              },
            },
          );
        },
      },
    );
  };

  const help = noChoice ? "ask-reask-help" : undefined;

  return (
    <section aria-labelledby="ask-vote">
      <h2 id="ask-vote">{LABELS.voteTitle}</h2>
      <div className="chip-row">
        <Chip
          pressed={mine?.helpful === true}
          onPress={() => {
            press(true);
          }}
        >
          <span aria-hidden="true">👍 </span>
          {COPY.voteUp}
        </Chip>
        <Chip
          pressed={down}
          onPress={() => {
            press(false);
          }}
        >
          <span aria-hidden="true">👎 </span>
          {COPY.voteDown}
        </Chip>
      </div>
      <p role="status" aria-live="polite" className="ask-vote-live" data-testid="ask-vote-live">
        {notice === "saved" ? (
          <>
            <span>{COPY.voteSaved1}</span> <span>{COPY.voteSaved2}</span>
          </>
        ) : notice === "down" ? (
          COPY.voteDownSaved
        ) : notice === "cleared" ? (
          COPY.voteCleared
        ) : null}
      </p>
      <VoteSummary votes={votes} me={by} />
      {vote.isError && (
        <div role="alert">
          <Notice tone="warn">{COPY.voteFail}</Notice>
        </div>
      )}

      {down && !showPanel && (
        <p>
          <button type="button" className="ask-linkbtn" onClick={openPanel}>
            {COPY.reasonChange}
          </button>
        </p>
      )}

      {showPanel && (
        <div className="card ask-reask" data-testid="ask-reask-panel">
          <h3 id="ask-reason">{COPY.reasonTitle}</h3>
          <ChipRadioGroup
            labelledBy="ask-reason"
            options={REASK_CHOICES.map((c) => ({ value: c, label: c }))}
            value={choice}
            onChange={setChoice}
          />
          <label htmlFor="ask-reask-text" className="ask-field-label">
            {COPY.reasonText}
          </label>
          <textarea
            id="ask-reask-text"
            className="field field-area"
            rows={3}
            maxLength={ASK_REASK_TEXT_MAX}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          {noChoice && (
            <p className="ask-help" id="ask-reask-help">
              {COPY.reasonHelp}
            </p>
          )}
          {left > 0 ? (
            <p className="meta">{reaskLeftLine(left)}</p>
          ) : (
            <Notice tone="info">{COPY.reaskMax}</Notice>
          )}
          <div className="actions">
            {left > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                aria-describedby={help}
                disabled={noChoice || vote.isPending || reask.isPending}
                onClick={askAgain}
              >
                {LABELS.reaskGo}
              </button>
            )}
            <button
              type="button"
              className="btn"
              aria-describedby={help}
              disabled={noChoice || vote.isPending}
              onClick={keepReason}
            >
              {LABELS.reasonSave}
            </button>
          </div>
          {reask.isError && (
            <div role="alert">
              <Notice tone="warn">{COPY.reaskFail}</Notice>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
