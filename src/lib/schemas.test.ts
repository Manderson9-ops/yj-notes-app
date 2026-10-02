import { createQueryClient, handleUnauthorized } from "./queryClient";
import { sessionSchema } from "./schemas";
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
