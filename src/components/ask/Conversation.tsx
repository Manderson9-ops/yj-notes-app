// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts). 제목·버튼 글자는 lib/ask/labels.ts 에 있다.
import { useState, type Ref } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ASK_TURN_MAX } from "../../../shared/ask-schema";
import { detectRedFlag } from "../../../server/ask/redflags";
import { ApiError } from "../../lib/api";
import { useAskTurn, type AskDetail } from "../../lib/ask/api";
import { COPY } from "../../lib/ask/copy";
import { turnCountLine } from "../../lib/ask/format";
import { LABELS } from "../../lib/ask/labels";
import { cardChange, continueDraft, lockKind, turnLimitReached } from "../../lib/ask/thread";
import { getDefaultRecorder } from "../../lib/logs/ids";
import { Notice } from "../Notice";
import { ChatInput } from "./ChatInput";
import { TurnBubble } from "./ChatBubble";

/** 보내기 실패를 고정 문구로(서버 응답의 error 값으로 가른다 — 본문·SQL 은 화면에 내지 않는다). */
export function turnErrorLine(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "too_many") return `${COPY.many1} ${COPY.many2}`;
    if (e.code === "turn_limit") return COPY.turnLimitServer;
    if (e.code === "turn_active") return COPY.turnBusy;
    if (e.code === "question_busy") return COPY.turnNotDone;
  }
  return COPY.sendFail;
}

/**
 * 답 카드 아래의 대화: 말풍선 목록 + 입력창. 질문이 끝나(done) 있을 때만 쓴다.
 * 한도(10번)를 넘으면 입력창 대신 「새 질문으로 이어가기」(원 질문 링크가 들어간 초안으로 /ask 이동).
 */
export function Conversation({
  detail,
  headingRef,
}: {
  detail: AskDetail;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const id = detail.question.id;
  const navigate = useNavigate();
  const send = useAskTurn(id);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const red = detectRedFlag(text).redFlag;
  const lock = lockKind(detail);
  const full = turnLimitReached(detail);

  const submit = () => {
    const by = getDefaultRecorder() ?? "가족";
    send.mutate(
      { body: text.trim(), askedBy: by },
      {
        onSuccess: (res) => {
          setText("");
          if (res.kind === "newQuestion") {
            // 질문이 아직 끝나지 않았을 때의 위급 후속: 서버가 새 위급 질문으로 만들었다 — 그 질문의 경고 화면으로 간다.
            void navigate(`/ask/${String(res.newQuestionId)}`);
            return;
          }
          setSent(true);
        },
      },
    );
  };

  const status = (
    <>
      {sent && !send.isError && !send.isPending && (
        <p className="meta" data-testid="ask-chat-sent">
          {COPY.chatSent}
        </p>
      )}
      {send.isError && (
        <div role="alert">
          <Notice tone="warn">{turnErrorLine(send.error)}</Notice>
        </div>
      )}
    </>
  );

  return (
    <section aria-labelledby="ask-chat" data-testid="ask-chat">
      <h2 id="ask-chat" ref={headingRef} tabIndex={-1}>
        {LABELS.chatTitle}
      </h2>
      <p className="meta" data-testid="ask-turn-count">
        {turnCountLine(detail.turnsUsed, ASK_TURN_MAX)}
      </p>
      {!detail.workerOnline && (
        <Notice tone="info">
          <span data-testid="ask-chat-offline">{COPY.chatOffline}</span>
        </Notice>
      )}
      {detail.turns.length === 0 ? (
        <p className="muted">{COPY.chatEmpty}</p>
      ) : (
        <ol className="ask-turns" aria-labelledby="ask-chat">
          {detail.turns.map((t) => (
            <TurnBubble key={t.id} turn={t} change={cardChange(detail, t)} />
          ))}
        </ol>
      )}
      {full ? (
        <div data-testid="ask-chat-full">
          <Notice tone="info">
            <span>{COPY.turnLimit}</span> <span>{COPY.turnLimitGo}</span>
          </Notice>
          <p>
            <Link
              to="/ask"
              state={{ draft: continueDraft(id, window.location.origin) }}
              className="btn-primary ask-send"
            >
              {LABELS.chatNew}
            </Link>
          </p>
        </div>
      ) : (
        <ChatInput
          value={text}
          onChange={(v) => {
            setText(v);
            setSent(false);
            if (send.isError) send.reset();
          }}
          onSend={submit}
          lock={lock}
          sending={send.isPending}
          red={red}
          status={status}
        />
      )}
    </section>
  );
}
