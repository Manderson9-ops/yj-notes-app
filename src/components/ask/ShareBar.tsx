// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts). 버튼 글자는 lib/ask/labels.ts 에 있다.
import { useState } from "react";
import type { AskDetail } from "../../lib/ask/api";
import { COPY } from "../../lib/ask/copy";
import { buildShareText, shareTitle, type ShareMode } from "../../lib/ask/share";
import { ChipRadioGroup } from "../ChipRadioGroup";

/** 클립보드 복사. 실패는 false. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Msg = { kind: "ok" } | { kind: "fail"; text: string } | null;

/**
 * 공유하기 / 복사하기(답변 맨 아래 한 곳). navigator.share 가 있으면 휴대폰 공유 시트(카카오톡·문자 등)에 title·text 를 넘기고
 * (글 끝에 링크가 이미 있어 url 은 따로 넘기지 않는다), 없으면 클립보드에 복사한다. 공유 취소는 조용히,
 * 복사 실패는 안내와 함께 글을 보여 줘 길게 눌러 복사할 수 있게 한다. 「보낼 내용」: 짧게 / 자세히(한 개만 고르는 라디오 그룹).
 */
export function ShareBar({
  detail,
  mode,
  onMode,
}: {
  detail: AskDetail;
  mode: ShareMode;
  onMode: (m: ShareMode) => void;
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const answer = detail.answer;
  if (!answer) return null;
  const input = {
    id: detail.question.id,
    body: detail.question.body,
    askedBy: detail.question.askedBy,
    createdAt: detail.question.createdAt,
    answer: answer.answer,
    // 행동 질문이 아닌 답은 단계를 어디에도 쓰지 않는다.
    level: answer.answer.kind === "not_behavior" ? null : answer.level,
    redFlag: detail.redFlag,
    origin: window.location.origin,
    mode,
  };

  const copyOrFail = async (text: string) => {
    setMsg((await copyText(text)) ? { kind: "ok" } : { kind: "fail", text });
  };

  const share = async () => {
    setMsg(null);
    const text = buildShareText(input);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle(input), text });
      } catch (e) {
        // 취소는 조용히. 그 밖의 실패는 복사로 넘어간다.
        if (!(e instanceof DOMException && e.name === "AbortError")) await copyOrFail(text);
      }
      return;
    }
    await copyOrFail(text);
  };

  return (
    <div className="ask-share" data-testid="ask-share">
      <p id="ask-share-range" className="ask-field-label">
        {COPY.shareRange}
      </p>
      <ChipRadioGroup
        labelledBy="ask-share-range"
        options={[
          { value: "summary", label: COPY.shareShort },
          { value: "full", label: COPY.shareLong },
        ]}
        value={mode}
        onChange={onMode}
      />
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary ask-bodyfont"
          onClick={() => {
            void share();
          }}
        >
          {COPY.shareBtn}
        </button>
        <button
          type="button"
          className="btn ask-bodyfont"
          onClick={() => {
            setMsg(null);
            void copyOrFail(buildShareText(input));
          }}
        >
          {COPY.copyBtn}
        </button>
      </div>
      <p className="meta">
        <span>{COPY.shareWarn}</span> <span>{COPY.shareWarn2}</span>
      </p>
      <p role="status" aria-live="polite" className="ask-share-live">
        {msg?.kind === "ok" ? COPY.shareCopied : msg?.kind === "fail" ? COPY.copyFail : null}
      </p>
      {msg?.kind === "fail" && (
        <textarea
          className="field field-area ask-copybox"
          readOnly
          rows={6}
          aria-label={COPY.shareBtn}
          value={msg.text}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
      )}
    </div>
  );
}
