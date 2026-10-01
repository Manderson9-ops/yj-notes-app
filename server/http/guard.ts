// functions/_middleware.ts 의 실제 로직 (docs/04 §4, docs/05).
// 순서: 경로 정규화 -> (API) Origin 확인 403 -> 세션 확인 401 -> JSON content-type 415 -> next().
// 어떤 경우에도 마지막에 보안 헤더를 덮어쓴다. 인증 검사 중 예외가 나면 fail closed(500/503).
import type { Deps } from "../deps";
import type { Env } from "../env";
import { authRequired, errorResponse, toErrorResponse } from "./errors";
import { applySecurityHeaders } from "./headers";

/**
 * 세션 없이 호출할 수 있는 API. "METHOD /path" 정확 일치만 허용한다(HEAD 는 GET 으로 본다).
 * 이 목록을 넓히려면 설계 담당 승인이 필요하다 (docs/05 인증 절, Q-SEC).
 */
export const AUTH_ALLOWLIST: readonly string[] = [
  "POST /api/session",
  "GET /api/session",
  "GET /api/health",
];

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;
const API_PATH = /^\/api(\/|$)/i;

export type Authenticate = (request: Request, env: Env, nowMs: number) => Promise<boolean>;

export interface GuardOptions {
  authenticate: Authenticate;
  deps: Pick<Deps, "now">;
}

/**
 * 퍼센트 디코딩 후 연속 슬래시를 합친 경로. 디코딩 불가면 null.
 * 라우터가 디코딩된 경로로 매칭할 수 있으므로(`/%61pi/...`) 가드도 같은 형태로 판단한다.
 */
export function normalizePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return decoded.replace(/\/{2,}/g, "/");
}

export function isApiPath(path: string): boolean {
  return API_PATH.test(path);
}

export function isAllowlisted(method: string, path: string): boolean {
  const effective = method === "HEAD" ? "GET" : method;
  return AUTH_ALLOWLIST.includes(`${effective} ${path}`);
}

/**
 * 본문이 실제로 있는가. 프록시(wrangler/Miniflare 등)가 본문 없는 DELETE 를 빈 스트림으로 넘기는 경우가
 * 있어 `request.body !== null` 만으로는 부족하다(로컬 스모크에서 확인). 순서:
 * Content-Length 가 있으면 그 값(0 이면 없음) -> body 가 null 이면 없음 -> 복제본에서 첫 비어 있지 않은
 * 조각을 하나 읽어 본다(전체를 버퍼링하지 않고, 원본 스트림은 건드리지 않는다).
 */
async function hasBody(request: Request): Promise<boolean> {
  const length = request.headers.get("Content-Length");
  if (length !== null) return length.trim() !== "0";
  if (request.body === null) return false;
  const stream: ReadableStream<Uint8Array> | null = request.clone().body;
  if (!stream) return false;
  const reader = stream.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return false;
      if (chunk.value.byteLength > 0) return true;
    }
  } finally {
    // 기다리지 않는다: tee 된 한쪽의 cancel 은 원본 쪽이 소비되기 전에는 끝나지 않아 멈춘다.
    void reader.cancel().catch(() => undefined);
  }
}

async function evaluate(
  request: Request,
  env: Env,
  next: () => Promise<Response>,
  path: string,
  options: GuardOptions,
): Promise<Response> {
  const method = request.method.toUpperCase();

  // 1) CSRF: 변경 요청은 Origin 이 자기 origin 과 정확히 같아야 한다 (없거나 "null" 이면 거부).
  if (!SAFE_METHODS.has(method)) {
    const origin = request.headers.get("Origin");
    if (origin !== new URL(request.url).origin) {
      return errorResponse(403, "bad_origin", "허용되지 않은 요청이에요.");
    }
  }

  // 2) 인증: 허용 목록 외 전부 세션 필요.
  if (!isAllowlisted(method, path)) {
    const ok = await options.authenticate(request, env, options.deps.now());
    if (!ok) return authRequired();
  }

  // 3) 본문이 있는 변경 요청은 JSON 만 (DELETE 등 본문 없는 요청은 통과).
  if (!SAFE_METHODS.has(method) && (await hasBody(request))) {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!JSON_CONTENT_TYPE.test(contentType)) {
      return errorResponse(415, "unsupported_media_type", "JSON 형식으로 보내 주세요.");
    }
  }

  return next();
}

/** Pages `_middleware` 본체. 모든 요청(정적 포함)이 지난다. */
export async function guardMiddleware(
  request: Request,
  env: Env,
  next: () => Promise<Response>,
  options: GuardOptions,
): Promise<Response> {
  const rawPath = new URL(request.url).pathname;
  const path = normalizePath(rawPath);
  if (path === null) {
    return applySecurityHeaders(
      errorResponse(400, "bad_request", "잘못된 요청이에요."),
      true,
      rawPath,
    );
  }
  const isApi = isApiPath(path);
  let res: Response;
  try {
    res = isApi ? await evaluate(request, env, next, path, options) : await next();
  } catch (e) {
    res = toErrorResponse(e, request.method, rawPath);
  }
  return applySecurityHeaders(res, isApi, path);
}
