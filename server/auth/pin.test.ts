import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, utf8 } from "./encoding";
import {
  PBKDF2_ITERATIONS,
  PinConfigError,
  hashPin,
  isPinConfigured,
  isValidPinFormat,
  parsePinLength,
  timingSafeEqual,
  verifyPin,
} from "./pin";

// 합성 값: 소금 00..0f, PIN 123456 (실제 PIN 아님). 기댓값은 node:crypto 로 독립 계산한 것.
const SALT = "AAECAwQFBgcICQoLDA0ODw==";
const VECTOR = "Pj0kIvAPLMHRutBFgZv7g2ARfVnFiANcQpTzQDrAl6U=";

describe("hashPin", () => {
  it("matches a known PBKDF2-SHA256 vector (100000 iterations, 32 bytes)", async () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(await hashPin("123456", SALT)).toBe(VECTOR);
  });

  it("is consistent with node:crypto for other inputs", async () => {
    const salt = base64ToBytes(SALT);
    for (const pin of ["0000", "999999999999", "042517"]) {
      const expected = bytesToBase64(pbkdf2Sync(pin, salt, 100_000, 32, "sha256"));
      expect(await hashPin(pin, SALT)).toBe(expected);
    }
  });

  it("differs per salt", async () => {
    expect(await hashPin("123456", "AQIDBAUGBwgJCgsMDQ4PEA==")).not.toBe(VECTOR);
  });
});

describe("verifyPin", () => {
  it("accepts the right PIN and rejects a wrong one", async () => {
    expect(await verifyPin("123456", SALT, VECTOR)).toBe(true);
    expect(await verifyPin("123457", SALT, VECTOR)).toBe(false);
  });

  it("rejects malformed PINs (length, characters) even if they would hash equal", async () => {
    for (const bad of ["", "123", "1234567890123", "12 456", "12345a", "１２３４５６", "-123456"]) {
      expect(isValidPinFormat(bad)).toBe(false);
      expect(await verifyPin(bad, SALT, VECTOR)).toBe(false);
    }
  });

  it("a malformed PIN never matches even when the stored hash is of the dummy PIN", async () => {
    const dummyHash = await hashPin("000000", SALT);
    expect(await verifyPin("000000", SALT, dummyHash)).toBe(true);
    expect(await verifyPin("00000", SALT, dummyHash)).toBe(false);
    expect(await verifyPin("", SALT, dummyHash)).toBe(false);
  });

  it("accepts the 4 and 12 digit boundaries", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("123456789012")).toBe(true);
  });

  it("throws on a misconfigured (non-base64) salt or hash so callers fail closed", async () => {
    await expect(verifyPin("123456", "FAKE_PLACEHOLDER!", VECTOR)).rejects.toThrow();
    await expect(verifyPin("123456", SALT, "not base64 !!")).rejects.toThrow();
  });
});

describe("timingSafeEqual", () => {
  it("compares content and length", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });
});

describe("encoding", () => {
  it("round-trips base64 and base64url (no padding)", () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 250) % 256);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      const url = bytesToBase64Url(bytes);
      expect(url).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64UrlToBytes(url)).toEqual(bytes);
    }
  });

  it("base64UrlToBytes returns null instead of throwing on junk", () => {
    expect(base64UrlToBytes("ab+c")).toBeNull();
    expect(base64UrlToBytes("a")).toBeNull();
    expect(base64UrlToBytes("ab=c")).toBeNull();
  });

  it("utf8 encodes", () => {
    expect(utf8("가")).toEqual(new Uint8Array([0xea, 0xb0, 0x80]));
  });
});

describe("parsePinLength", () => {
  it("accepts only integer strings 4..12", () => {
    for (let n = 4; n <= 12; n++) expect(parsePinLength(String(n))).toBe(n);
    for (const bad of [undefined, "", "3", "13", "004", "4.0", " 4", "4 ", "abc", "-4", "1e1"]) {
      expect(parsePinLength(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("isPinConfigured", () => {
  it("needs non-empty string PIN_HASH and PIN_SALT", () => {
    expect(isPinConfigured({ PIN_HASH: "a", PIN_SALT: "b" })).toBe(true);
    expect(isPinConfigured({ PIN_HASH: "", PIN_SALT: "b" })).toBe(false);
    expect(isPinConfigured({ PIN_HASH: "a" })).toBe(false);
    expect(isPinConfigured({ PIN_HASH: 1, PIN_SALT: "b" })).toBe(false);
  });
});

describe("verifyPin config validation (R1-2)", () => {
  it("throws PinConfigError when the expected hash is not 32 bytes", async () => {
    const short = bytesToBase64(new Uint8Array(16));
    await expect(verifyPin("123456", SALT, short)).rejects.toBeInstanceOf(PinConfigError);
    await expect(verifyPin("123456", SALT, bytesToBase64(new Uint8Array(33)))).rejects.toThrow(
      PinConfigError,
    );
  });
  it("throws PinConfigError when the salt decodes to fewer than 8 bytes", async () => {
    await expect(
      verifyPin("123456", bytesToBase64(new Uint8Array(7)), VECTOR),
    ).rejects.toBeInstanceOf(PinConfigError);
  });
  it("still works with an 8-byte salt", async () => {
    const salt = bytesToBase64(new Uint8Array(8).fill(1));
    expect(await verifyPin("123456", salt, await hashPin("123456", salt))).toBe(true);
  });
});
