// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
// 대화(T-Q5) 화면이 쓰는 순수 계산: 입력 잠금 종류·한도·위급 실패·카드 갱신 전후 단계·새 질문 초안. 화면과 시험이 같이 쓴다.
import { ASK_TURN_MAX } from "../../../shared/ask-schema";
import type { AskDetail, AskTurn } from "./api";

/** 집 PC가 일하는 중인 짧은 답 단계(턴 status). */
const REPLY_ACTIVE = ["pending", "claimed", "answering", "reviewing"] as const;

export const isReplyActive = (t: Pick<AskTurn, "status">): boolean =>
  (REPLY_ACTIVE as readonly string[]).includes(t.status);

/** 카드 단계가 도는 중인 턴(짧은 답은 끝났거나 필요 없음). */
export const isCardActive = (t: Pick<AskTurn, "status" | "cardStatus">): boolean =>
  t.status === "done" && t.cardStatus === "pending";

/**
 * 입력 잠금 종류. reply = 짧은 답을 만드는 중, card = 카드를 다시 정리하는 중, null = 잠금 없음.
 * 서버가 threadActive 를 켰는데 턴 목록에서 이유를 못 찾으면(낡은 목록) reply 로 둔다.
 */
export function lockKind(d: Pick<AskDetail, "turns" | "threadActive">): "reply" | "card" | null {
  if (d.turns.some(isReplyActive)) return "reply";
  if (d.turns.some(isCardActive)) return "card";
  return d.threadActive ? "reply" : null;
}

/** 위급이 아닌 턴 수가 한도(10번)에 이르렀는가. */
export const turnLimitReached = (d: Pick<AskDetail, "turnsUsed">): boolean =>
  d.turnsUsed >= ASK_TURN_MAX;

/** 위급 턴의 카드를 끝내 만들지 못했는가(홈의 위급 미처리와 같은 뜻 — 정상 종료로 다루지 않는다). */
export const hasRedCardFailed = (d: Pick<AskDetail, "turns">): boolean =>
  d.turns.some((t) => t.redFlag && t.cardStatus === "failed");

/** 카드 갱신 횟수가 한도에 이르렀는가(다시 답변 막힘). */
export const cardLimitReached = (d: Pick<AskDetail, "cardUpdates">): boolean =>
  d.cardUpdates.used >= d.cardUpdates.max;

/**
 * 이 턴이 카드를 새로 만들었을 때의 단계 변화. 카드 번호(cardVersion = 이 턴이 만든 카드의 번호)로 이력(history)에서 앞뒤 카드를 찾는다:
 * 앞 카드 = 번호 cardVersion-1, 새 카드 = 번호 cardVersion(이력에 없으면 지금 카드 = answer).
 * cardVersion 이 없으면 가장 최근 갱신으로 보고 「이력의 마지막 단계 → 지금 단계」로 본다.
 * 카드를 갱신하지 않았으면 null. 단계가 없는 카드(행동 질문이 아님)는 숫자를 null 로 둔다.
 */
export function cardChange(
  d: Pick<AskDetail, "history" | "answer" | "turns">,
  turn: Pick<AskTurn, "id" | "cardStatus" | "cardVersion">,
): { from: number | null; to: number | null } | null {
  if (turn.cardStatus !== "done") return null;
  const levelOfHistory = (version: number): number | null => {
    const h = d.history.find((x) => x.version === version);
    return h ? (h.level ?? h.answer.level) : null;
  };
  const now = d.answer ? (d.answer.level ?? d.answer.answer.level) : null;
  const last = d.history.at(-1);
  const v = turn.cardVersion;
  if (v === null) {
    const latestDone = [...d.turns].reverse().find((t) => t.cardStatus === "done");
    if (latestDone?.id !== turn.id || last === undefined) return null;
    return { from: last.level ?? last.answer.level, to: now };
  }
  const from = levelOfHistory(v - 1);
  const to = v > d.history.length ? now : levelOfHistory(v);
  return { from, to };
}

/** 한도 뒤 「새 질문으로 이어가기」: 원 질문 링크를 붙인 새 질문 초안. */
export function continueDraft(questionId: number, origin: string): string {
  return `이어서 물어요 (이전 질문: ${origin}/ask/${String(questionId)})\n`;
}
