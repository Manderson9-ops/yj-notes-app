// 평가·dry-run 용 주입 파일 읽기: 가족 결과(--history)와 다시 답변 상황(--reask). 형식은 docs/12-ask-worker.md.
import { z } from "zod";
import {
  ClaimReaskSchema,
  HistoryItemSchema,
  type ClaimReask,
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
