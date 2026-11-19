// 물어보기(S30) API 훅. 응답 모양은 서버(server/routes/ask.ts)가 정본이고 여기는 화면용 복사본이다.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ASK_CARD_NOTES,
  ASK_CARD_STATUSES,
  ASK_REASK_MAX,
  ASK_TURN_KINDS,
  AnswerSchema,
  FollowupSchema,
  type ReaskChoice,
} from "../../../shared/ask-schema";
import { ApiError, api } from "../api";
import { overviewKey } from "../notesApi";

/** 진행 중(질문 pending~reviewing, 또는 집 PC가 일하는 중인 턴) 조회 간격. */
export const POLL_MS = 5000;
/** 활성 턴이 있는데 집 PC가 꺼져 있을 때: 여러 기기가 자주 묻지 않게 느리게(R5). */
export const POLL_OFFLINE_MS = 30_000;
/** 끝난 질문의 상세가 열려 있을 때: 다른 가족의 후속을 보려고 가끔 다시 본다. */
export const POLL_IDLE_MS = 60_000;

const statusSchema = z.enum(["pending", "claimed", "answering", "reviewing", "done", "failed"]);
export type AskStatusValue = z.infer<typeof statusSchema>;

export const instantSchema = z.object({
  notes: z.array(z.object({ id: z.number(), date: z.string(), snippet: z.string() })),
  docs: z.array(z.object({ slug: z.string(), title: z.string() })),
});
export type Instant = z.infer<typeof instantSchema>;

const createdSchema = z.object({
  id: z.number().int(),
  status: statusSchema,
  redFlag: z.boolean(),
  instant: instantSchema,
});

const listItemSchema = z.object({
  id: z.number().int(),
  askedBy: z.string(),
  bodyPreview: z.string(),
  status: statusSchema,
  redFlag: z.boolean(),
  level: z.number().int().optional(),
  createdAt: z.string(),
  /** 가족 표 수(👍/👎). */
  votes: z.object({ up: z.number().int(), down: z.number().int() }).optional(),
});
export type AskListItem = z.infer<typeof listItemSchema>;
const listSchema = z.object({
  items: z.array(listItemSchema),
  nextBefore: z.number().int().nullable(),
});

const feedbackSchema = z.object({
  id: z.number().int(),
  by: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export type AskFeedbackItem = z.infer<typeof feedbackSchema>;

const voteSchema = z.object({
  by: z.string(),
  helpful: z.boolean(),
  reason: z.string().nullable(),
  updatedAt: z.string(),
});
export type AskVoteItem = z.infer<typeof voteSchema>;
const votesSchema = z.object({ votes: z.array(voteSchema) });

const historyItemSchema = z.object({
  version: z.number().int(),
  level: z.number().int().nullable(),
  createdAt: z.string(),
  answer: AnswerSchema,
});
export type AskHistoryItem = z.infer<typeof historyItemSchema>;

const turnSchema = z.object({
  id: z.number().int(),
  seq: z.number().int(),
  kind: z.enum(ASK_TURN_KINDS),
  askedBy: z.string(),
  body: z.string(),
  reaskReason: z.string().nullable().default(null),
  redFlag: z.boolean(),
  /** 짧은 답 단계(질문과 같은 6종). */
  status: statusSchema,
  /** reply_json 을 못 읽으면 null(서버가 그렇게 내린다). 화면은 못 읽은 답을 만들어 내지 않는다. */
  reply: FollowupSchema.nullable().catch(null),
  reviewScore: z.number().nullable().default(null),
  cardStatus: z.enum(ASK_CARD_STATUSES),
  cardNote: z.enum(ASK_CARD_NOTES).nullable().catch(null),
  cardVersion: z.number().int().nullable().default(null),
  createdAt: z.string(),
  repliedAt: z.string().nullable().default(null),
});
export type AskTurn = z.infer<typeof turnSchema>;

const detailBase = z.object({
  question: z.object({
    id: z.number().int(),
    askedBy: z.string(),
    body: z.string(),
    createdAt: z.string(),
  }),
  status: statusSchema,
  redFlag: z.boolean(),
  answer: z
    .object({
      /** not_behavior 답은 null(단계를 보이지 않는다) */
      level: z.number().int().nullable(),
      answer: AnswerSchema,
      createdAt: z.string(),
      totalMs: z.number().nullable(),
      /** 집 PC 품질 검사 점수(0~10). 9.5 미만이면 화면에 참고용 안내를 낸다. */
      reviewScore: z.number().nullable().optional(),
    })
    .optional(),
  feedback: z.array(feedbackSchema),
  votes: z.array(voteSchema).default([]),
  /** 이전 답변들(오래된 것부터). 최신 답은 answer. */
  history: z.array(historyItemSchema).default([]),
  reask: z
    .object({
      count: z.number().int(),
      reason: z.string().nullable(),
      by: z.string().nullable(),
    })
    .default({ count: 0, reason: null, by: null }),
  /** T-Q5 대화. 옛 서버 응답에는 없으므로 모두 기본값을 둔다(활성 턴 없음·집 PC 켜짐으로 읽는다). */
  workerOnline: z.boolean().default(true),
  threadActive: z.boolean().default(false),
  redLock: z.boolean().default(false),
  cardUpdates: z.object({ used: z.number().int(), max: z.number().int() }).optional(),
  turnsUsed: z.number().int().default(0),
  originQuestionId: z.number().int().nullable().default(null),
  turns: z.array(turnSchema).default([]),
});
/** cardUpdates 가 없는 옛 응답은 다시 답변 횟수(reask.count)를 쓴다(서버 이행: card_updates = reask_count). */
const detailSchema = detailBase.transform((d) => ({
  ...d,
  cardUpdates: d.cardUpdates ?? { used: d.reask.count, max: ASK_REASK_MAX },
}));
export type AskDetail = z.infer<typeof detailSchema>;

export const askKey = ["ask"] as const;

export function useAskList() {
  return useInfiniteQuery({
    queryKey: [...askKey, "list"],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api("GET", `/ask${pageParam === null ? "" : `?before=${String(pageParam)}`}`, {
        schema: listSchema,
      }),
    getNextPageParam: (last) => last.nextBefore,
  });
}

/**
 * 상세를 다시 볼 간격(ms), 멈추면 false. 순수 함수라 단위 시험이 간격 세 갈래를 직접 확인한다.
 * - 질문이 아직 끝나지 않았다(pending~reviewing): 지금처럼 5초(집 PC 켜짐 여부와 무관 — 첫 질문 경로 그대로).
 * - 끝났고 활성 턴이 있다: 집 PC가 켜져 있으면 5초, 꺼져 있으면 30초(+ 화면의 「집 PC가 켜지면 답변해요」).
 * - 끝났고(done) 활성 턴이 없다: 60초(다른 가족의 후속을 보이게. 화면이 숨으면 TanStack 이 멈춘다).
 * - 실패한 질문(활성 턴 없음): 멈춘다(더 바뀌는 것이 없다).
 */
export function detailPollMs(
  d: Pick<AskDetail, "status" | "threadActive" | "workerOnline"> | undefined,
): number | false {
  if (d === undefined) return POLL_MS;
  if (d.status !== "done" && d.status !== "failed") return POLL_MS;
  if (d.threadActive) return d.workerOnline ? POLL_MS : POLL_OFFLINE_MS;
  return d.status === "done" ? POLL_IDLE_MS : false;
}

/** 상세: 위 간격으로 다시 본다. 탭이 숨겨지면 TanStack 이 멈춘다. */
export function useAskDetail(id: number | null) {
  return useQuery({
    queryKey: [...askKey, "detail", id],
    enabled: id !== null,
    queryFn: () => api("GET", `/ask/${String(id)}`, { schema: detailSchema }),
    refetchInterval: (query) => detailPollMs(query.state.data),
    refetchIntervalInBackground: false,
  });
}

export function useInstant(id: number | null) {
  return useQuery({
    queryKey: [...askKey, "instant", id],
    enabled: id !== null,
    staleTime: Infinity,
    queryFn: () => api("GET", `/ask/${String(id)}/instant`, { schema: instantSchema }),
  });
}

export function useCreateAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string; askedBy: string }) =>
      api("POST", "/ask", { body: v, schema: createdSchema }),
    onSuccess: (res) => {
      qc.setQueryData([...askKey, "instant", res.id], res.instant);
      void qc.invalidateQueries({ queryKey: [...askKey, "list"] });
      void qc.invalidateQueries({ queryKey: overviewKey });
    },
  });
}

/** 해 봤어요 메모(도움 여부는 useAskVote). */
export function useAskFeedback(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { by: string; note: string }) =>
      api("POST", `/ask/${String(id)}/feedback`, { body: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...askKey, "detail", id] }),
  });
}

/** 표: 사람당 한 표(바꾸기 가능). helpful null 이면 취소. 이유는 👎 때만. */
export function useAskVote(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { by: string; helpful: boolean | null; reason?: string }) =>
      api("PUT", `/ask/${String(id)}/vote`, { body: v, schema: votesSchema }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...askKey, "detail", id] });
      void qc.invalidateQueries({ queryKey: [...askKey, "list"] });
      void qc.invalidateQueries({ queryKey: overviewKey });
    },
  });
}

/**
 * 다시 답변 받기: 이유 선택지 + 자유 글. 질문은 `done` 으로 남고(카드도 그대로) kind=reask 턴이 만들어져
 * 카드만 새로 만든다(대화 속 빠른 답). 진행 중 턴이 있으면 409 — 그 턴을 보이게 상세를 다시 본다.
 */
export function useAskReask(id: number) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [...askKey, "detail", id] });
    void qc.invalidateQueries({ queryKey: [...askKey, "list"] });
    void qc.invalidateQueries({ queryKey: overviewKey });
  };
  return useMutation({
    mutationFn: (v: { by: string; choice: ReaskChoice; text?: string }) =>
      api("POST", `/ask/${String(id)}/reask`, { body: v }),
    onSuccess: refresh,
    onError: (e) => {
      if (isTurnConflict(e)) refresh();
    },
  });
}

/** 턴 만들기 성공 응답: 일반·위급 후속은 { id, seq, redFlag }, 질문이 아직 done 이 아닐 때의 위급은 { newQuestionId }. */
const turnCreatedSchema = z
  .union([
    z.object({ newQuestionId: z.number().int(), redFlag: z.boolean() }),
    z.object({ id: z.number().int(), seq: z.number().int(), redFlag: z.boolean() }),
  ])
  .transform((r) =>
    "newQuestionId" in r
      ? ({ kind: "newQuestion", newQuestionId: r.newQuestionId, redFlag: r.redFlag } as const)
      : ({ kind: "turn", id: r.id, seq: r.seq, redFlag: r.redFlag } as const),
  );
export type TurnCreated = z.infer<typeof turnCreatedSchema>;

/** 409(진행 중 턴·질문이 아직 끝나지 않음)이나 429 turn_limit: 화면이 낡았다는 뜻이라 상세를 다시 본다. */
export function isTurnConflict(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 409 || e.code === "turn_limit");
}

/**
 * 이어서 묻기(후속 질문). 성공하면 상세를 다시 본다(캐시에 남은 threadActive=false 때문에 조회가 멈추지 않게).
 * 결과가 newQuestion 이면 호출자가 그 질문으로 이동한다. 409 turn_active 면 다른 가족이 보낸 턴을 보이게 상세를 다시 본다.
 */
export function useAskTurn(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string; askedBy: string }) =>
      api("POST", `/ask/${String(id)}/turn`, { body: v, schema: turnCreatedSchema }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...askKey, "detail", id] });
      void qc.invalidateQueries({ queryKey: [...askKey, "list"] });
      void qc.invalidateQueries({ queryKey: overviewKey });
    },
    onError: (e) => {
      if (isTurnConflict(e)) void qc.invalidateQueries({ queryKey: [...askKey, "detail", id] });
    },
  });
}

export function useDeleteAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api("DELETE", `/ask/${String(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: askKey }),
  });
}
