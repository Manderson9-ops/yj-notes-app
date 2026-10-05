// 워커 API 클라이언트 (spec §3). Bearer + Origin(APP_ORIGIN). 응답 본문·질문 내용은 오류에 싣지 않는다.
import { z } from "zod";
import type { Answer } from "./answer-schema.ts";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`api_${status}`);
    this.name = "ApiError";
    this.status = status;
  }
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

export type ClaimedQuestion = z.infer<typeof claimedSchema>["question"];

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

export interface AskClient {
  claim(signal?: AbortSignal): Promise<ClaimedQuestion | null>;
  progress(id: number, status: ProgressStatus): Promise<void>;
  answer(id: number, body: AnswerUpload): Promise<void>;
  fail(id: number, code: string): Promise<void>;
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
    if (!res.ok) throw new ApiError(res.status);
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
      const parsed = claimedSchema.safeParse(json);
      if (!parsed.success) throw new ApiError(502);
      return parsed.data.question;
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
    async ping() {
      await call("/api/worker/ping", "GET");
    },
  };
}
