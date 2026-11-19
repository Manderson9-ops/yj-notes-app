// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import { splitReaskReason } from "../../../shared/ask-schema";
import type { AskTurn } from "../../lib/ask/api";
import { COPY } from "../../lib/ask/copy";
import { STATUS_LINE, cardChangeLine, whenKo } from "../../lib/ask/format";
import { Notice } from "../Notice";

/** 카드 상태·진행 줄(라이브 영역 안: 바뀌면 스크린리더가 읽는다). 짧은 답이 이미 보인 뒤의 카드 단계도 여기서 보인다. */
function TurnState({
  turn,
  change,
}: {
  turn: AskTurn;
  change: { from: number | null; to: number | null } | null;
}) {
  if (turn.status === "failed") return <p>{COPY.turnFail}</p>;
  if (turn.status !== "done") return <p>{STATUS_LINE[turn.status]}</p>;
  switch (turn.cardStatus) {
    case "pending":
      return <p>{COPY.cardRedo}</p>;
    case "done":
      return <Notice tone="info">{cardChangeLine(change ?? { from: null, to: null })}</Notice>;
    case "failed":
      return turn.redFlag ? (
        <Notice tone="alert">{COPY.cardRedFail}</Notice>
      ) : (
        <Notice tone="info">{COPY.cardKeep}</Notice>
      );
    case "none":
      return null;
  }
}

/** 카드를 갱신하지 않은 이유(card_note): 짧은 답 아래에 고정 문구로. */
function CardNote({ note }: { note: AskTurn["cardNote"] }) {
  if (note === "limit") return <Notice tone="info">{COPY.noteLimit}</Notice>;
  if (note === "redlock") return <Notice tone="info">{COPY.noteRedlock}</Notice>;
  return null;
}

/**
 * 대화 한 턴 = 말풍선 두 개: 묻는 사람(이름·시각·본문) → 집 PC의 짧은 답(또는 진행 단계·카드 상태).
 * 말풍선은 보내는 쪽/받는 쪽을 색만이 아니라 이름 줄(글)과 자리로도 가른다. 판정 문구 없음(P1).
 */
export function TurnBubble({
  turn,
  change,
}: {
  turn: AskTurn;
  change: { from: number | null; to: number | null } | null;
}) {
  const reaskChoice =
    turn.kind === "reask" && turn.reaskReason !== null
      ? (splitReaskReason(turn.reaskReason).choice ?? turn.reaskReason)
      : null;
  const reply = turn.reply;
  return (
    <li className="ask-turn" data-kind={turn.kind} data-red={turn.redFlag ? "1" : undefined}>
      <div className="ask-bubble" data-role="asker">
        <p className="meta ask-bubble-by">
          {turn.askedBy} · {whenKo(turn.createdAt)}
          {turn.redFlag && <span className="badge ask-bubble-badge">{COPY.redBadge}</span>}
        </p>
        {reaskChoice !== null && (
          <p className="ask-bubble-text">
            <strong>{COPY.reaskAsked}</strong>: {reaskChoice}
          </p>
        )}
        {turn.body !== "" && <p className="ask-bubble-text">{turn.body}</p>}
      </div>
      <div className="ask-bubble" data-role="reply">
        <p className="meta ask-bubble-by">{COPY.askerSays}</p>
        {reply !== null && (
          <>
            <p className="ask-bubble-text">{reply.reply}</p>
            {reply.say !== undefined && <q className="ask-say">{reply.say}</q>}
            {reply.fromRecords.length > 0 && (
              <ul className="ask-list ask-bubble-list">
                {reply.fromRecords.map((r, i) => (
                  <li key={`${r.date}-${String(i)}`}>
                    <span className="meta">
                      {r.date} · {r.source}
                    </span>
                    <br />
                    {r.what}
                  </li>
                ))}
              </ul>
            )}
            {reply.evidence.length > 0 && (
              <ul className="ask-list ask-bubble-list">
                {reply.evidence.map((e, i) => (
                  <li key={`${e.ref}-${String(i)}`}>
                    {e.point}
                    <br />
                    <span className="meta">{e.ref}</span>
                  </li>
                ))}
              </ul>
            )}
            {reply.limits !== undefined && <p className="meta">{reply.limits}</p>}
          </>
        )}
        <div
          role="status"
          aria-live="polite"
          className="ask-bubble-live"
          data-testid="ask-turn-live"
        >
          <TurnState turn={turn} change={change} />
        </div>
        <CardNote note={turn.cardNote} />
      </div>
    </li>
  );
}
