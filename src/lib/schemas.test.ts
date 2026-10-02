import { createQueryClient, handleUnauthorized } from "./queryClient";
import { parseErrorBody, sessionSchema } from "./schemas";
import { sessionQueryKey } from "./session";

describe("handleUnauthorized keeps the server pinLength", () => {
  it.each([
    [
      { authenticated: true, pinLength: 6 },
      { authenticated: false, pinLength: 6 },
    ],
    [{ authenticated: true }, { authenticated: false }],
    [undefined, { authenticated: false }],
  ])("%j -> %j", (before, after) => {
    const qc = createQueryClient();
    if (before) qc.setQueryData(sessionQueryKey, before);
    handleUnauthorized(qc);
    expect(qc.getQueryData(sessionQueryKey)).toEqual(after);
  });
});

describe("sessionSchema pinLength", () => {
  it("keeps a valid pinLength", () => {
    expect(sessionSchema.parse({ authenticated: false, pinLength: 6 })).toEqual({
      authenticated: false,
      pinLength: 6,
    });
  });

  it("treats a missing or out-of-range pinLength as absent (old 4~12 + confirm flow)", () => {
    expect(sessionSchema.parse({ authenticated: true }).pinLength).toBeUndefined();
    for (const bad of [3, 13, 4.5, "6", null]) {
      expect(
        sessionSchema.parse({ authenticated: false, pinLength: bad }).pinLength,
      ).toBeUndefined();
    }
  });
});

describe("parseErrorBody", () => {
  it("배열·null·원시값·error 없음/비문자열은 null", () => {
    for (const bad of [
      null,
      undefined,
      [],
      [{ error: "x" }],
      "x",
      7,
      {},
      { error: 1 },
      { error: null },
    ]) {
      expect(parseErrorBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("올바른 본문은 그대로", () => {
    expect(
      parseErrorBody({ error: "locked", message: "m", retryAfterSec: 30, fields: { a: "b" } }),
    ).toEqual({ error: "locked", message: "m", retryAfterSec: 30, fields: { a: "b" } });
    expect(parseErrorBody({ error: "x" })).toEqual({ error: "x" });
  });
  it("retryAfterSec 가 음수·소수·문자열이면 그 항목만 버린다", () => {
    for (const r of [-1, 1.5, "30", NaN, null]) {
      expect(parseErrorBody({ error: "x", retryAfterSec: r }), String(r)).toEqual({ error: "x" });
    }
    expect(parseErrorBody({ error: "x", retryAfterSec: 0 })).toEqual({
      error: "x",
      retryAfterSec: 0,
    });
  });
  it("fields 에 문자열이 아닌 값이 있거나 객체가 아니면 fields 만 버린다", () => {
    expect(parseErrorBody({ error: "x", fields: { a: 1 } })).toEqual({ error: "x" });
    expect(parseErrorBody({ error: "x", fields: ["a"] })).toEqual({ error: "x" });
    expect(parseErrorBody({ error: "x", fields: null })).toEqual({ error: "x" });
    expect(parseErrorBody({ error: "x", message: 5 })).toEqual({ error: "x" });
  });
});
