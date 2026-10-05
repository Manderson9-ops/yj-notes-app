// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import type { Answer } from "../../shared/ask-schema";

/** 물어보기 답변 카드 시안(합성 예시). 실제 화면의 내용은 서버가 검증한 답변이다. */
export function previewAnswer(level: number, reason: string): Answer {
  return {
    kind: "behavior",
    level,
    levelTitle: "예시",
    levelReason: reason,
    summary: "테스트아이가 밥 먹을 때 숟가락을 던져요 (예시)",
    fromRecords: [
      {
        date: "2020-01-15",
        what: "간식 시간에 숟가락을 놓았어요 (예시)",
        link: "밥 먹을 때 던지는 모습과 이어져요",
        source: "알림장",
      },
    ],
    evidence: [
      { ref: "예시-근거-1", point: "이 또래에서 자주 보이는 행동이에요 (예시)", grade: "B" },
    ],
    tryNow: [
      {
        action: "먹는 양보다 앉아 있는 시간을 칭찬해 주세요",
        say: "앉아서 잘 먹고 있네",
        basis: "예시-근거-1",
      },
      { action: "던지면 조용히 치우고 한 번 더 알려 주세요", basis: "일반 권고" },
    ],
    avoid: ["큰 소리로 혼내기 (예시)"],
    observe: { what: "던지는 횟수", howLong: "1주", how: "하루 한 번 적어 두기" },
    upIf: ["하루 5번 넘게 던져요. 소아과에 물어봐요 (예시)"],
    downIf: ["일주일 동안 한 번도 없어요 (예시)"],
    forAsker: "엄마께: 오늘은 같이 앉아 주세요 (예시)",
  };
}
