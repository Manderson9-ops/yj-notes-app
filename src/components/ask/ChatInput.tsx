// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts). 제목·버튼 글자는 lib/ask/labels.ts 에 있다.
import type { ReactNode, SyntheticEvent } from "react";
import { ASK_BODY_MAX } from "../../../shared/ask-schema";
import { COPY } from "../../lib/ask/copy";
import { LABELS } from "../../lib/ask/labels";
import { RedFlagCard } from "./RedFlagCard";

/**
 * 이어서 묻기 입력창(1~1000자). 위급 신호가 있으면 쓰는 즉시 경고 카드(첫 질문 화면과 같다).
 * 활성 턴이 있는 동안(lock)은 보내기를 막고 이유를 보인다 — 글은 미리 써 둘 수 있고, 위급 신호가 있는 글만 바로 보낼 수 있다
 * (서버도 위급 후속은 진행 중 턴·10번 한도와 상관없이 받는다).
 */
export function ChatInput({
  value,
  onChange,
  onSend,
  lock,
  sending,
  red,
  status,
  idBase = "ask-chat",
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  lock: "reply" | "card" | null;
  sending: boolean;
  red: boolean;
  /** 보냈다·실패 같은 알림(라이브 영역 밖에서 따로 꾸린다). */
  status?: ReactNode;
  /** 한 화면에 입력창이 둘 이상일 때(디자인 미리보기) id 가 겹치지 않게. */
  idBase?: string;
}) {
  const lockText = lock === "card" ? COPY.lockCard : lock === "reply" ? COPY.lockReply : "";
  const blocked = lock !== null && !red;
  const canSend = value.trim() !== "" && !sending && !blocked;
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (canSend) onSend();
  };
  return (
    <form onSubmit={submit} aria-label="이어서 묻기" className="ask-chat-form">
      <label htmlFor={`${idBase}-body`} className="ask-field-label">
        {COPY.chatLabel}
      </label>
      <textarea
        id={`${idBase}-body`}
        className="field field-area ask-body"
        rows={3}
        maxLength={ASK_BODY_MAX}
        placeholder={COPY.chatHint}
        value={value}
        aria-describedby={`${idBase}-lock`}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      <p className="meta" aria-hidden="true">
        {value.length} / {ASK_BODY_MAX}
      </p>
      {red && <RedFlagCard />}
      <p
        id={`${idBase}-lock`}
        role="status"
        aria-live="polite"
        className="ask-lock"
        data-testid="ask-chat-lock"
      >
        {lockText}
        {lock !== null && red ? ` · ${COPY.lockRedOk}` : ""}
      </p>
      {status}
      <button type="submit" className="btn-primary ask-send" disabled={!canSend}>
        {sending ? LABELS.chatSending : LABELS.chatSend}
      </button>
    </form>
  );
}
