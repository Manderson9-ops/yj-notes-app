// 테스트용 합성 자료(테스트아이/2020). 실제 자료 없음.
import type { Answer } from "./answer-schema.ts";
import { levelTitle } from "./levels.ts";

export const PACK = {
  pack: "## A. 아이 요약\n- 월령: 30개월 (가장 최근 알림장 2020-03-05 기준)\n- [ref: note:2020-03-02] 2020-03-02 밥을 반만 먹었어요\n- [ref: SYN-IV-01] 실천",
  refs: ["note:2020-03-02", "SYN-IV-01", "checkup:1"],
  tokens: 100,
};

export function goodAnswer(over: Partial<Answer> = {}): Answer {
  const level = over.level ?? 4;
  return {
    level,
    levelTitle: levelTitle(level),
    levelReason: "며칠째 반복되지만 다른 활동에는 지장이 없어요.",
    summary: "테스트아이가 점심을 반만 먹는 일이 며칠째 이어져요.",
    fromRecords: [{ date: "2020-03-02", what: "점심을 반만 먹었어요", source: "알림장" }],
    evidence: [
      { ref: "SYN-IV-01", point: "식사 시간을 일정하게 하면 도움이 돼요", grade: "MODERATE" },
    ],
    tryNow: [
      { action: "식사 시간을 30분으로 정해요", say: "밥 먹고 놀자" },
      { action: "간식 간격을 2시간 이상 두어요" },
    ],
    avoid: ["억지로 먹이지 않아요"],
    observe: { what: "먹은 양", howLong: "1주", how: "끼니마다 반 그릇인지 적어요" },
    upIf: ["체중이 줄어요"],
    downIf: ["이틀 이상 잘 먹어요"],
    ...over,
  };
}
