// 테스트용 합성 자료(테스트아이/2020). 실제 자료 없음.
import { LEVEL_TEMPLATES } from "../../shared/ask-levels.ts";
import type {
  ClaimThread,
  ClaimTurn,
  ClaimTurnResponse,
  Followup,
} from "../../shared/ask-schema.ts";
import type { Answer } from "./answer-schema.ts";
import { levelTitle } from "./levels.ts";

export const PACK = {
  pack: "## A. 아이 요약\n- 현재 월령: 30개월\n- [ref: note:2020-03-02] 2020-03-02 밥을 반만 먹었어요\n- [ref: SYN-IV-01] 실천",
  refs: ["note:2020-03-02", "SYN-IV-01", "checkup:1"],
  tokens: 100,
};

/** 단계별 틀을 만족하는 합성 답(기본 4단계). over 로 덮어쓴다. */
export function goodAnswer(over: Partial<Answer> = {}): Answer {
  const level = over.level ?? 4;
  const t = LEVEL_TEMPLATES[level];
  const base: Answer = {
    kind: "behavior",
    level,
    levelTitle: levelTitle(level),
    levelReason: "30개월이고 알림장 기록에서 며칠째 반복되지만 다른 활동에는 지장이 없어요.",
    summary: "테스트아이가 점심을 반만 먹는 일이 며칠째 이어져요.",
    fromRecords: [
      {
        date: "2020-03-02",
        what: "점심을 반만 먹었어요",
        link: "밥 먹는 양이 줄었다는 질문과 이어져요",
        source: "알림장",
      },
    ],
    evidence: [
      { ref: "SYN-IV-01", point: "식사 시간을 일정하게 하면 도움이 돼요", grade: "MODERATE" },
    ],
    tryNow: [
      { action: "식사 시간을 정해 두어요", say: "밥 먹고 놀자", basis: "SYN-IV-01" },
      { action: "간식 간격을 넉넉히 두어요", basis: "일반 권고" },
      { action: "식탁에서 영상은 끄고 함께 앉아요", basis: "일반 권고" },
    ].slice(0, Math.min(2, t?.tryNow[1] ?? 2)),
    avoid: ["억지로 먹이지 않아요"],
    observe: {
      what: "먹은 양",
      howLong: t?.howLongLabel ?? "3~4일",
      how: "끼니마다 반 그릇인지 적어요",
    },
    upIf: ["체중이 줄면 소아과에 물어봐요"],
    downIf: ["이틀 이상 잘 먹어요"],
    forAsker: "엄마께: 오늘 저녁은 천천히 함께 앉아 먹어요",
  };
  return { ...base, ...over };
}

/** 검토 결과(JSON) 합성: 지적 목록과 이전 지적 처리 여부. */
export function review(
  issues: { category: string; where?: string; fix?: string }[] = [],
  previousStatus: { index: number; fixed: boolean }[] = [],
) {
  return {
    issues: issues.map((i) => ({
      category: i.category,
      where: i.where ?? "levelReason",
      fix: i.fix ?? "고쳐요",
    })),
    previousStatus,
  };
}

/** 후속 짧은 답 합성본(근거·기록은 PACK 에 있는 것만). over 로 덮어쓴다. */
export function goodFollowup(over: Partial<Followup> = {}): Followup {
  return {
    reply: "간식은 밥 시간에서 두 시간쯤 떨어뜨려 주면 밥을 덜 남겨요. 같은 자리에서 함께 먹어요.",
    say: "배고프면 밥 먹자",
    fromRecords: [
      {
        date: "2020-03-02",
        what: "점심을 반만 먹었어요",
        link: "밥 먹는 양과 간식 시간이 이어져요",
        source: "알림장",
      },
    ],
    evidence: [{ ref: "SYN-IV-01", point: "식사 시간을 일정하게 하면 도움이 돼요" }],
    cardUpdate: { needed: false, reason: "" },
    ...over,
  };
}

/** claim 응답(턴) 합성본: 첫 후속 질문의 짧은 답 단계. 얕은 덮어쓰기 + turn·thread 안쪽 덮어쓰기. */
export function claimTurn(
  over: {
    stage?: "reply" | "card";
    cardUpdatesLeft?: number;
    redLock?: boolean;
    turn?: Partial<ClaimTurn>;
    thread?: Partial<ClaimThread>;
  } = {},
): ClaimTurnResponse {
  return {
    type: "turn",
    stage: over.stage ?? "reply",
    cardUpdatesLeft: over.cardUpdatesLeft ?? 3,
    redLock: over.redLock ?? false,
    turn: {
      id: 11,
      seq: 1,
      kind: "followup",
      body: "간식은 줘도 될까요",
      redFlag: false,
      reaskReason: null,
      askedBy: "아빠",
      reply: null,
      cardReason: null,
      ...over.turn,
    },
    thread: {
      question: {
        id: 3,
        body: "테스트아이가 점심에 밥을 잘 안 먹어요",
        askedBy: "엄마",
        createdAt: "2020-03-01T00:00:00.000Z",
        redFlag: false,
      },
      card: goodAnswer(),
      turns: [],
      ...over.thread,
    },
  };
}
