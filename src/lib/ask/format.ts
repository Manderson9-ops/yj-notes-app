// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import { formatShortKo, seoulDateOf, timeKo } from "../dateFormat";
import type { AskStatusValue } from "./api";

export const STATUS_LABEL: Record<AskStatusValue, string> = {
  pending: "접수",
  claimed: "작성 중",
  answering: "작성 중",
  reviewing: "검토 중",
  done: "완료",
  failed: "답변 실패",
};

/** 진행 단계 표시(접수 → 작성 중 → 검토 중 → 완료). 현재 위치는 0~3. */
export const STEPS = ["접수", "작성 중", "검토 중", "완료"] as const;

export function stepIndex(status: AskStatusValue): number {
  switch (status) {
    case "pending":
      return 0;
    case "claimed":
    case "answering":
      return 1;
    case "reviewing":
      return 2;
    case "done":
      return 3;
    case "failed":
      return 0;
  }
}

/** 지금 상태를 한 줄로(aria-live 로 읽힌다). */
export const STATUS_LINE: Record<AskStatusValue, string> = {
  pending: "질문을 받았어요. 집 PC가 곧 집어요.",
  claimed: "집 PC가 질문을 받았어요.",
  answering: "답을 쓰는 중이에요.",
  reviewing: "쓴 답을 검토하는 중이에요.",
  done: "답이 나왔어요.",
  failed: "답을 만들지 못했어요.",
};

/** ISO(UTC) -> 「3월 2일 (월) 오후 4:10」 (한국 시간). */
export function whenKo(iso: string): string {
  const date = seoulDateOf(iso);
  const t = new Date(iso);
  const hm = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
  return `${formatShortKo(date)} ${timeKo(hm)}`;
}

/** 받침이 있으면 이, 없으면 가(이름 뒤 주격 조사). 한글이 아니면 「가」. */
export function subjectParticle(name: string): "이" | "가" {
  const last = name.trim().at(-1);
  if (last === undefined) return "가";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

/** 「아빠가 다시 요청했어요: 이미 해 봤어요」 (이유 선택지만, 자유 글은 보이지 않는다). */
export function reaskByLine(by: string, choice: string): string {
  const name = by.trim() === "" ? "가족" : by.trim();
  return `${name}${subjectParticle(name)} 다시 요청했어요: ${choice}`;
}

/** 「다시 답변을 2번 더 받을 수 있어요.」 */
export function reaskLeftLine(left: number): string {
  return `다시 답변을 ${String(left)}번 더 받을 수 있어요.`;
}

/** 이전 답변 줄: 「1번째 답 · 1월 15일」 (한국 시간 날짜). */
export function oldAnswerLine(version: number, iso: string): string {
  const [, m = "0", d = "0"] = seoulDateOf(iso).split("-");
  return `${String(version)}번째 답 · ${String(Number(m))}월 ${String(Number(d))}일`;
}
