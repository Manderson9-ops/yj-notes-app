import { describe, expect, it } from "vitest";
import { CSP, STATIC_SECURITY_HEADERS, applySecurityHeaders, reportCsp } from "./headers";

describe("security headers (docs/04 §4)", () => {
  it("CSP matches the documented policy verbatim", () => {
    expect(CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
        "frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
        "frame-ancestors 'none'; form-action 'self'",
    );
  });

  it("reportCsp is the sandboxed report policy", () => {
    expect(reportCsp).toBe(
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data:; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'",
    );
    // 주소를 직접 열어도 앱 origin 에서 실행되지 않게: CSP sandbox 에 allow-same-origin 이 없어야 한다.
    expect(reportCsp.startsWith("sandbox allow-scripts;")).toBe(true);
    expect(reportCsp).not.toContain("allow-same-origin");
  });

  it("applies every header to a static response and leaves its Cache-Control alone", () => {
    const res = applySecurityHeaders(
      new Response("x", { headers: { "Cache-Control": "public, max-age=60" } }),
      false,
      "/index.html",
    );
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS))
      expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("forces no-store on API responses", () => {
    const res = applySecurityHeaders(
      new Response("{}", { headers: { "Cache-Control": "public" } }),
      true,
      "/api/x",
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("overwrites a CSP set by a route, except reportCsp on the raw report path", () => {
    const weak = () =>
      new Response("", { headers: { "Content-Security-Policy": "default-src *" } });
    const report = () => new Response("", { headers: { "Content-Security-Policy": reportCsp } });
    const csp = (res: Response) => res.headers.get("Content-Security-Policy");

    expect(csp(applySecurityHeaders(weak(), true, "/api/notes"))).toBe(CSP);
    expect(csp(applySecurityHeaders(report(), true, "/api/reports/abc/raw"))).toBe(reportCsp);
    // reportCsp on any other path is replaced
    expect(csp(applySecurityHeaders(report(), true, "/api/reports/abc"))).toBe(CSP);
    // a different CSP on the raw path is replaced too
    expect(csp(applySecurityHeaders(weak(), true, "/api/reports/abc/raw"))).toBe(CSP);
  });

  it("returns upgrade (101) responses untouched", () => {
    const res = { status: 101, headers: new Headers() } as unknown as Response;
    expect(applySecurityHeaders(res, false, "/")).toBe(res);
  });

  it("preserves status, body and other headers", async () => {
    const res = applySecurityHeaders(
      new Response("hello", { status: 418, headers: { "X-Custom": "1" } }),
      true,
      "/api/x",
    );
    expect(res.status).toBe(418);
    expect(res.headers.get("X-Custom")).toBe("1");
    expect(await res.text()).toBe("hello");
  });
});
