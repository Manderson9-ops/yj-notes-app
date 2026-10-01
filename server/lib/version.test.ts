import { formatVersion } from "./version";

describe("formatVersion", () => {
  it("returns the trimmed version", () => {
    expect(formatVersion(" 1.2.3 ")).toBe("1.2.3");
  });
  it("falls back to unknown when empty", () => {
    expect(formatVersion("  ")).toBe("unknown");
  });
});
