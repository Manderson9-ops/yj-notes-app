// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import { useState } from "react";
import type { AskDetail } from "../../lib/ask/api";
import { COPY } from "../../lib/ask/copy";
import { buildShareText, shareTitle, shareUrl, type ShareMode } from "../../lib/ask/share";
import { Chip } from "../Chip";

/** 클립보드 복사. 실패는 false(조용히). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 공유하기 / 복사하기. navigator.share 가 있으면 휴대폰 공유 시트(카카오톡·문자 등), 없으면 클립보드에 복사한다.
 * 실패·취소는 조용히 넘어간다. 요약만/전체 선택은 위아래 두 줄이 함께 쓴다.
 */
export function ShareBar({
  detail,
  mode,
  onMode,
  where,
}: {
  detail: AskDetail;
  mode: ShareMode;
  onMode: (m: ShareMode) => void;
  where: "top" | "bottom";
}) {
  const [msg, setMsg] = useState("");
  const answer = detail.answer;
  if (!answer) return null;
  const input = {
    id: detail.question.id,
    body: detail.question.body,
    askedBy: detail.question.askedBy,
    createdAt: detail.question.createdAt,
    answer: answer.answer,
    level: answer.level,
    redFlag: detail.redFlag,
    origin: window.location.origin,
    mode,
  };

  const share = async () => {
    setMsg("");
    const text = buildShareText(input);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: shareTitle(input),
          text,
          url: shareUrl(input.origin, input.id),
        });
      } catch {
        // 취소·실패는 조용히
      }
      return;
    }
    if (await copyText(text)) setMsg(COPY.shareCopied);
  };
  const copy = async () => {
    setMsg("");
    if (await copyText(buildShareText(input))) setMsg(COPY.shareCopied);
  };

  return (
    <div className="ask-share" data-where={where} data-testid={`ask-share-${where}`}>
      <div className="chip-row" role="group" aria-label="공유할 범위">
        <Chip
          pressed={mode === "summary"}
          onPress={() => {
            onMode("summary");
          }}
        >
          {COPY.shareSummary}
        </Chip>
        <Chip
          pressed={mode === "full"}
          onPress={() => {
            onMode("full");
          }}
        >
          {COPY.shareFull}
        </Chip>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void share();
          }}
        >
          {COPY.shareTitle}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void copy();
          }}
        >
          {COPY.shareCopy}
        </button>
      </div>
      <p className="meta">
        <span>{COPY.shareWarn}</span> <span>{COPY.shareWarn2}</span>
      </p>
      <p role="status" aria-live="polite" className="ask-share-live">
        {msg}
      </p>
    </div>
  );
}
