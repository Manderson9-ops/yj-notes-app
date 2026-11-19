// 워커 API 클라이언트 (spec §3). Bearer + Origin(APP_ORIGIN). 응답 본문·질문 내용은 오류에 싣지 않는다.
import { z } from "zod";
import {
  ASK_CARD_STATUSES,
  ClaimReaskSchema,
  ClaimTurnResponseSchema,
  HistoryResponseSchema,
  type AskCardStatus,
  type ClaimTurnResponse,
  type HistoryItem,
  type TurnProgress,
  type TurnReply,
} from "../../shared/ask-schema.ts";
import type { Answer } from "./answer-schema.ts";

export class ApiError extends Error {
  readonly status: number;
  /** 응답 본문의 `code`(없으면 `error`) 값. 본문 내용은 싣지 않고, 소문자·숫자·밑줄 40자 이내의 코드만 받는다. */
  readonly code: string | undefined;
  constructor(status: number, code?: string) {
    super(`api_${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const CODE_RE = /^[a-z0-9_]{1,40}$/;

/** 오류 응답 본문에서 코드만 꺼낸다(JSON 이 아니거나 모양이 다르면 undefined). */
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const j: unknown = await res.json();
    if (typeof j !== "object" || j === null) return undefined;
    const o = j as { code?: unknown; error?: unknown };
    for (const v of [o.code, o.error]) if (typeof v === "string" && CODE_RE.test(v)) return v;
  } catch {
    // 본문이 없거나 JSON 이 아니면 코드 없음
  }
  return undefined;
}

export class NetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

export const claimedSchema = z.object({
  question: z.object({
    id: z.number().int(),
    body: z.string(),
    askedBy: z.string(),
    createdAt: z.string(),
    redFlag: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)),
  }),
});

/** claim 응답: 질문 + (다시 답변이면) 이전 답·이유. */
const claimResponseSchema = claimedSchema.extend({ reask: ClaimReaskSchema.optional() });
export type ClaimedQuestion = z.infer<typeof claimedSchema>["question"] & {
  reask?: z.infer<typeof ClaimReaskSchema>;
};

/** history 응답 크기 방어(서버 상한 200KB 의 두 배 넘으면 버린다). */
export const HISTORY_READ_MAX = 400_000;

export interface AnswerUpload {
  level: number;
  answer: Answer;
  reviewScore: number;
  model: string;
  workMs: number;
}

export type ProgressStatus = "answering" | "reviewing";

export interface ClientOptions {
  origin: string;
  token: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** T-Q5: claim 이 돌려준 턴(짧은 답 단계 또는 카드 단계 한 가지). 최상위 question 이 없다. */
export type ClaimedTurn = ClaimTurnResponse;

/** 응답에 `type:"turn"` 이 있으면 턴. 질문 응답은 type 이 없거나("question") 이 키가 없는 옛 모양이다. */
export function isTurnClaim(c: ClaimedQuestion | ClaimedTurn): c is ClaimedTurn {
  return "type" in c;
}

export type TurnStage = "reply" | "card";

export interface AskClient {
  claim(signal?: AbortSignal): Promise<ClaimedQuestion | ClaimedTurn | null>;
  /** 최근 끝난 질문과 가족 의견(GET /api/worker/ask/history). 본문이 있으니 로그에 쓰지 않는다. */
  history(limit?: number, signal?: AbortSignal): Promise<HistoryItem[]>;
  progress(id: number, status: ProgressStatus): Promise<void>;
  answer(id: number, body: AnswerUpload): Promise<void>;
  fail(id: number, code: string): Promise<void>;
  /** 턴 진행(짧은 답 단계는 answering·reviewing, 카드 단계는 리스 연장만). */
  turnProgress(turnId: number, body: TurnProgress): Promise<void>;
  /** 짧은 답 확정. 서버가 정한 카드 단계 상태(모르면 null)를 돌려준다. */
  turnReply(turnId: number, body: TurnReply): Promise<{ cardStatus: AskCardStatus | null }>;
  /** 갱신한 카드 업로드(질문 /answer 와 같은 본문). */
  turnCard(turnId: number, body: AnswerUpload): Promise<void>;
  turnFail(turnId: number, stage: TurnStage, code: string): Promise<void>;
  ping(): Promise<void>;
}

export function createClient(o: ClientOptions): AskClient {
  const doFetch = o.fetchFn ?? fetch;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const base = o.origin.replace(/\/$/, "");

  async function call(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${o.token}`, Origin: base };
    const timeout = AbortSignal.timeout(timeoutMs);
    const init: RequestInit = {
      method,
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch {
      throw new NetworkError();
    }
    if (!res.ok) throw new ApiError(res.status, await errorCodeOf(res));
    return res;
  }

  return {
    async claim(signal) {
      const res = await call("/api/worker/ask/claim", "POST", {}, signal);
      if (res.status === 204) return null;
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ApiError(502);
      }
      const type =
        typeof json === "object" && json !== null ? (json as { type?: unknown }).type : undefined;
      if (type === "turn") {
        const turn = ClaimTurnResponseSchema.safeParse(json);
        if (!turn.success) throw new ApiError(502);
        return turn.data;
      }
      // type 이 없으면(옛 서버) 질문으로 본다. "question" 도 같다.
      if (type !== undefined && type !== "question") throw new ApiError(502);
      const parsed = claimResponseSchema.safeParse(json);
      if (!parsed.success) throw new ApiError(502);
      return parsed.data.reask
        ? { ...parsed.data.question, reask: parsed.data.reask }
        : parsed.data.question;
    },
    async history(limit = 60, signal) {
      const n = Math.max(1, Math.min(100, Math.trunc(limit)));
      const res = await call(
        `/api/worker/ask/history?limit=${String(n)}`,
        "GET",
        undefined,
        signal,
      );
      let text: string;
      try {
        text = await res.text();
      } catch {
        throw new ApiError(502);
      }
      if (text.length > HISTORY_READ_MAX) throw new ApiError(502);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError(502);
      }
      const parsed = HistoryResponseSchema.safeParse(json);
      if (!parsed.success) throw new ApiError(502);
      return parsed.data.items;
    },
    async progress(id, status) {
      await call(`/api/worker/ask/${id}/progress`, "POST", { status });
    },
    async answer(id, body) {
      await call(`/api/worker/ask/${id}/answer`, "POST", body);
    },
    async fail(id, code) {
      await call(`/api/worker/ask/${id}/fail`, "POST", { code });
    },
    async turnProgress(turnId, body) {
      await call(`/api/worker/ask/turn/${turnId}/progress`, "POST", body);
    },
    async turnReply(turnId, body) {
      const res = await call(`/api/worker/ask/turn/${turnId}/reply`, "POST", body);
      let cardStatus: AskCardStatus | null = null;
      try {
        const j = (await res.json()) as { cardStatus?: unknown };
        cardStatus = ASK_CARD_STATUSES.find((s) => s === j.cardStatus) ?? null;
      } catch {
        // 응답 본문은 로그용이라 읽지 못해도 확정은 끝난 것이다
      }
      return { cardStatus };
    },
    async turnCard(turnId, body) {
      await call(`/api/worker/ask/turn/${turnId}/card`, "POST", body);
    },
    async turnFail(turnId, stage, code) {
      await call(`/api/worker/ask/turn/${turnId}/fail`, "POST", { stage, code });
    },
    async ping() {
      await call("/api/worker/ping", "GET");
    },
  };
}
