// 물어보기(S30) API 훅. 응답 모양은 서버(server/routes/ask.ts)가 정본이고 여기는 화면용 복사본이다.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AnswerSchema } from "../../../shared/ask-schema";
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
});
export type AskListItem = z.infer<typeof listItemSchema>;
const listSchema = z.object({
  items: z.array(listItemSchema),
  nextBefore: z.number().int().nullable(),
});

const feedbackSchema = z.object({
  id: z.number().int(),
  by: z.string(),
  helpful: z.boolean().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type AskFeedbackItem = z.infer<typeof feedbackSchema>;

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
      level: z.number().int(),
      answer: AnswerSchema,
      createdAt: z.string(),
      totalMs: z.number().nullable(),
      /** 집 PC 품질 검사 점수(0~10). 9.5 미만이면 화면에 참고용 안내를 낸다. */
      reviewScore: z.number().nullable().optional(),
    })
    .optional(),
  feedback: z.array(feedbackSchema),
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

export function useAskFeedback(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { by: string; helpful?: boolean; note?: string }) =>
      api("POST", `/ask/${String(id)}/feedback`, { body: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...askKey, "detail", id] }),
  });
}

export function useDeleteAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api("DELETE", `/ask/${String(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: askKey }),
  });
}
