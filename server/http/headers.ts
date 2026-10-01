// 응답 보안 헤더 (docs/04 §4). 모든 응답(정적·API)에 적용한다.
// Security headers applied to EVERY response, static and API.

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "frame-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

/**
 * `/api/reports/:slug/raw` 응답 전용 CSP (docs/04 §4). 기존 보고서 HTML 의 인라인 스크립트용.
 * sandbox="allow-scripts"(allow-same-origin 없음) iframe 안에서만 띄운다. connect-src 'none'.
 */
export const reportCsp = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** 이 경로의 응답만 reportCsp 를 쓸 수 있다. */
const REPORT_RAW_PATH = /^\/api\/reports\/[^/]+\/raw$/;

export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * 응답 복사본에 보안 헤더를 덮어쓴다(정적 자산 응답의 헤더는 불변일 수 있어 새 Response 로 감쌈).
 * - CSP: 항상 CSP 로 덮어쓴다. 단 REPORT_RAW_PATH 이고 라우트가 reportCsp 를 정확히 지정한 경우만 유지.
 * - /api/* : Cache-Control: private, no-store.
 */
export function applySecurityHeaders(res: Response, isApi: boolean, path: string): Response {
  // WebSocket 업그레이드(101)는 webSocket 속성이 새 Response 로 복사되지 않으므로 그대로 둔다(이 앱은 WS 를 쓰지 않는다).
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  const keepReportCsp =
    REPORT_RAW_PATH.test(path) && out.headers.get("Content-Security-Policy") === reportCsp;
  if (!keepReportCsp) out.headers.set("Content-Security-Policy", CSP);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) out.headers.set(name, value);
  if (isApi) out.headers.set("Cache-Control", "private, no-store");
  return out;
}
