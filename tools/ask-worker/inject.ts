// 평가·dry-run 용 주입 파일 읽기: 가족 결과(--history)·다시 답변 상황(--reask)·이어진 대화(--thread). 형식은 docs/12-ask-worker.md.
import { z } from "zod";
import {
  AnswerSchema,
  ASK_THREAD_TURNS,
  ASK_TURN_KINDS,
  ClaimReaskSchema,
  FollowupSchema,
  HistoryItemSchema,
  type ClaimReask,
  type ClaimThread,
  type HistoryItem,
} from "../../shared/ask-schema.ts";

/** --history 파일: 배열 또는 {items}. */
export function parseHistory(text: string): HistoryItem[] {
  const json: unknown = JSON.parse(text);
  const arr = typeof json === "object" && json !== null && "items" in json ? json.items : json;
  return z.array(HistoryItemSchema).parse(arr);
}

const reaskInputSchema = ClaimReaskSchema.extend({
  count: z.number().int().min(1).default(1),
  by: z.string().max(12).default("가족"),
});

/** --reask 파일: 한 덩어리(모든 문항) 또는 {골든 id: 덩어리}. 반환은 문항 id 로 찾는 함수. */
export function parseReask(text: string): (id: string) => ClaimReask | undefined {
  const json: unknown = JSON.parse(text);
  if (typeof json === "object" && json !== null && "reason" in json) {
    const one = reaskInputSchema.parse(json);
    return () => one;
  }
  const map = z.record(z.string(), reaskInputSchema).parse(json);
  return (id) => map[id];
}

const threadInputSchema = z.object({
  question: z.object({
    body: z.string().min(1).max(1000),
    askedBy: z.string().max(12).default("가족"),
    id: z.number().int().default(0),
    createdAt: z.string().default("2020-03-01T00:00:00.000Z"),
    redFlag: z.boolean().default(false),
  }),
  card: AnswerSchema.nullable().default(null),
  turns: z
    .array(
      z.object({
        by: z.string().max(12).default("가족"),
        body: z.string().max(1000),
        reply: FollowupSchema.nullable().default(null),
        kind: z.enum(ASK_TURN_KINDS).default("followup"),
        reaskReason: z.string().nullable().default(null),
      }),
    )
    .max(ASK_THREAD_TURNS)
    .default([]),
});

/**
 * --thread 파일(T-Q5 멀티턴 평가): 한 덩어리 {"question":{body,…},"card":<Answer>,"turns":[{by,body,reply,…}]}(모든 문항)
 * 또는 {"<골든 id>": 덩어리}. 골든 한 줄의 question 이 그 대화 뒤에 새로 들어오는 후속 질문이다. 반환은 문항 id 로 찾는 함수.
 */
export function parseThread(text: string): (id: string) => ClaimThread | undefined {
  const json: unknown = JSON.parse(text);
  if (typeof json === "object" && json !== null && "question" in json) {
    const one = threadInputSchema.parse(json);
    return () => one;
  }
  const map = z.record(z.string(), threadInputSchema).parse(json);
  return (id) => map[id];
}
