// 물어보기(S30) API 훅. 응답 모양은 서버(server/routes/ask.ts)가 정본이고 여기는 화면용 복사본이다.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AnswerSchema, type ReaskChoice } from "../../../shared/ask-schema";
import { api } from "../api";
import { overviewKey } from "../notesApi";

export const POLL_MS = 5000;

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

const detailSchema = z.object({
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
});
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

/** 상세: 끝나기 전에는 5초마다 다시 본다(완료·실패면 멈춤). 탭이 숨겨지면 TanStack 이 멈춘다. */
export function useAskDetail(id: number | null) {
  return useQuery({
    queryKey: [...askKey, "detail", id],
    enabled: id !== null,
    queryFn: () => api("GET", `/ask/${String(id)}`, { schema: detailSchema }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : POLL_MS;
    },
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

/** 다시 답변 받기: 이유 선택지 + 자유 글. 성공하면 질문이 다시 대기로 돌아간다. */
export function useAskReask(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { by: string; choice: ReaskChoice; text?: string }) =>
      api("POST", `/ask/${String(id)}/reask`, { body: v }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...askKey, "detail", id] });
      void qc.invalidateQueries({ queryKey: [...askKey, "list"] });
      void qc.invalidateQueries({ queryKey: overviewKey });
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
