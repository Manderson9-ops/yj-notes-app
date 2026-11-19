// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import type { AskTurn } from "../lib/ask/api";

/** S91 미리보기용 대화 시안(합성 예시): 짧은 답 + 카드 갱신 / 카드 정리 중 / 카드 한도. 실제 화면의 내용은 서버 값이다. */
const base = {
  askedBy: "엄마",
  reaskReason: null,
  redFlag: false,
  status: "done",
  reviewScore: 9.6,
  cardStatus: "none",
  cardNote: null,
  cardVersion: null,
  createdAt: "2020-01-15T05:00:00.000Z",
  repliedAt: "2020-01-15T05:01:00.000Z",
} as const;

export const PREVIEW_TURNS: readonly AskTurn[] = [
  {
    ...base,
    id: 1,
    seq: 1,
    kind: "followup",
    body: "밤에도 같은 방법을 써도 될까요? (예시)",
    reply: {
      reply: "밤에는 조용한 목소리로 한 번만 알려 주세요 (예시)",
      say: "지금은 자는 시간이야",
      fromRecords: [
        {
          date: "2020-01-14",
          what: "낮잠 전에 인형을 안고 있었어요 (합성)",
          link: "잠들기 전 모습과 이어져요",
          source: "알림장",
        },
      ],
      evidence: [],
      cardUpdate: { needed: true, reason: "밤 상황을 카드에 더해요 (예시)" },
      limits: "알림장에는 낮 모습만 있어요 (예시)",
    },
    cardStatus: "done",
    cardVersion: 2,
  },
  {
    ...base,
    id: 2,
    seq: 2,
    kind: "reask",
    askedBy: "아빠",
    body: "",
    reaskReason: "이미 해 봤어요",
    reply: null,
    cardStatus: "pending",
  },
  {
    ...base,
    id: 3,
    seq: 3,
    kind: "followup",
    askedBy: "할머니",
    body: "다른 방법도 있을까요? (예시)",
    reply: {
      reply: "같은 시간에 같은 순서로 해 보세요 (예시)",
      fromRecords: [],
      evidence: [],
      cardUpdate: { needed: true, reason: "예시" },
    },
    cardNote: "limit",
  },
];

/** 위 시안의 카드 갱신 전후 단계(첫 턴). */
export const PREVIEW_CHANGE = { from: 5, to: 4 } as const;
