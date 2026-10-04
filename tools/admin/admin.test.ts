import { describe, expect, it } from "vitest";
import { hashPin } from "../../server/auth/pin";
import {
  computePinHash,
  formatOutput,
  PBKDF2_ITERATIONS,
  PIN_PATTERN,
  PIN_TOO_SHORT_MESSAGE,
} from "./pin-hash";
import { REVOKE_SQL, parseArgs, printableCommand, wranglerArgs } from "./session-revoke";

describe("pin-hash tool", () => {
  it("produces the same hash as the server implementation", async () => {
    const salt = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    expect(computePinHash("123456", salt)).toBe(await hashPin("123456", salt.toString("base64")));
    expect(PBKDF2_ITERATIONS).toBe(100_000);
  });

  it("R1-1: admin tool requires 6-12 digits (server still accepts 4-12)", () => {
    expect(PIN_PATTERN.test("123456")).toBe(true);
    expect(PIN_PATTERN.test("123456789012")).toBe(true);
    expect(PIN_PATTERN.test("1234")).toBe(false);
    expect(PIN_PATTERN.test("12345")).toBe(false);
    expect(PIN_TOO_SHORT_MESSAGE).toContain("6~12자리");
    expect(PIN_PATTERN.test("12345678901234")).toBe(false);
    expect(PIN_PATTERN.test("12a456")).toBe(false);
  });

  it("prints salt, hash and the exact wrangler commands", () => {
    const out = formatOutput("SALT_B64", "HASH_B64");
    expect(out).toContain("PIN_SALT=SALT_B64");
    expect(out).toContain("PIN_HASH=HASH_B64");
    expect(out).toContain("npx wrangler pages secret put PIN_HASH --project-name yj-notes-app");
    expect(out).toContain("npx wrangler pages secret put PIN_SALT --project-name yj-notes-app");
  });
});

describe("pin-hash tool: PIN_LENGTH", () => {
  it("prints the length (never the PIN) with the secret command and a mismatch warning", () => {
    const out = formatOutput("S", "H", 6);
    expect(out).toContain("PIN_LENGTH=6");
    expect(out).toContain("npx wrangler pages secret put PIN_LENGTH --project-name yj-notes-app");
    expect(out).toContain("실제 PIN 길이와 다르면 아무도 로그인할 수 없다");
  });
  it("without a length it prints no PIN_LENGTH lines", () => {
    expect(formatOutput("S", "H")).not.toContain("PIN_LENGTH");
  });
});

describe("session-revoke tool", () => {
  it("increments session_epoch", () => {
    expect(REVOKE_SQL).toBe(
      "UPDATE app_setting SET value = CAST(value AS INTEGER)+1 WHERE key='session_epoch'",
    );
  });

  it("builds argv without a shell, targeting --local or --remote", () => {
    expect(wranglerArgs("local")).toEqual([
      "d1",
      "execute",
      "DB",
      "--local",
      "--command",
      REVOKE_SQL,
    ]);
    expect(wranglerArgs("remote")).toContain("--remote");
    expect(printableCommand("remote")).toBe(
      `npx wrangler d1 execute DB --remote --command "${REVOKE_SQL}"`,
    );
  });

  it("parses flags", () => {
    expect(parseArgs([])).toBe("both");
    expect(parseArgs(["--local"])).toBe("local");
    expect(parseArgs(["--remote"])).toBe("remote");
    expect(parseArgs(["--local", "--remote"])).toBe("invalid");
    expect(parseArgs(["--yolo"])).toBe("invalid");
  });
});
