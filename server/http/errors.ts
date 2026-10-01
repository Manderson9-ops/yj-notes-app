// 오류 응답 형식 (docs/05): {"error": "<code>", "message": "<한국어>"} — 자료·SQL·스택 금지.
// Error response helpers. Bodies never contain data, SQL or stack traces.

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(
  status: number,
  error: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return jsonResponse(status, { error, message, ...extra }, headers);
}

export function authRequired(): Response {
  return errorResponse(401, "auth_required", "로그인이 필요해요.");
}

/**
 * D1 한도/과부하 오류 판별 (heuristic).
 * D1 은 일일 한도 초과·과부하를 안정적인 오류 코드 없이 문자열 메시지로만 알린다
 * (예: "...exceeded its limit...", "D1 DB reached its ... limit"). 그래서 메시지에
 * "limit" 또는 "exceeded" 가 들어 있으면 quota 로 본다(대소문자 무시).
 * 오탐은 503 안내로 끝나고(자료 노출 없음), 미탐은 500 으로 떨어질 뿐이다.
 * 메시지 자체는 응답·로그 어디에도 쓰지 않는다.
 */
export function isQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const lower = message.toLowerCase();
  return lower.includes("limit") || lower.includes("exceeded");
}

/** 처리되지 않은 예외 -> 일반화된 JSON 응답. 로그는 method+path+status 만. */
export function toErrorResponse(e: unknown, method: string, path: string): Response {
  const quota = isQuotaError(e);
  const res = quota
    ? errorResponse(
        503,
        "quota_exceeded",
        "오늘 사용 한도에 도달했어요. 내일 오전 9시(KST) 이후 다시 시도해 주세요.",
      )
    : errorResponse(500, "internal", "잠시 후 다시 시도해 주세요.");
  console.error(`${method} ${path} ${String(res.status)}`);
  return res;
}
