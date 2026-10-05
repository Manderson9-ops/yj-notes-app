// 물어보기 시험 도구: 세션 요청·워커 요청·합성 답변. 합성 자료만(테스트아이).
import type { Answer } from "../../shared/ask-schema";
import { ORIGIN, TEST_WORKER_TOKEN, type Harness } from "./harness";

export function sessionCall(
  h: Harness,
  cookie: string,
  method: string,
  path: string,
  json?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { Cookie: cookie };
  const init: RequestInit = { method, headers };
  if (method !== "GET") headers.Origin = ORIGIN;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  return h.handle(new Request(ORIGIN + path, init));
}

export function workerCall(
  h: Harness,
  method: string,
  path: string,
  json?: unknown,
  token: string | null = TEST_WORKER_TOKEN,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  return h.handle(new Request(ORIGIN + path, init));
}

export function syntheticAnswer(level = 5, over: Partial<Answer> = {}): Answer {
  return {
    level,
    levelTitle: "방법 바꾸며 1주 기록",
    levelReason: "합성 예시 이유예요.",
    summary: "테스트아이가 합성 상황에서 자주 보이는 행동이에요.",
    fromRecords: [{ date: "2020-01-15", what: "합성 알림장 예시", source: "알림장" }],
    evidence: [{ ref: "E-SYN-1", point: "합성 근거 예시", grade: "B" }],
    tryNow: [{ action: "먼저 안아 주기", say: "많이 속상했구나" }, { action: "잠시 쉬기" }],
    avoid: ["큰 소리로 혼내기"],
    observe: { what: "횟수", howLong: "1주", how: "하루 한 번 적기" },
    upIf: ["하루 5번 이상으로 늘어요"],
    downIf: ["일주일 동안 한 번도 없어요"],
    ...over,
  };
}

export function workerAnswerBody(level = 5, over: Partial<Answer> = {}) {
  return {
    level,
    answer: syntheticAnswer(level, over),
    reviewScore: 9.6,
    model: "opus-synthetic",
    workMs: 42_000,
  };
}

export function rows<T>(h: Harness, sql: string): T[] {
  return h.fake.sqlite.prepare(sql).all() as T[];
}
