// T-Q4a: 로그 보관 일수(pruneLogs 에 넘기는 값)와 시작 로그의 CLAUDE_CODE_EFFORT_LEVEL 유무.
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pruneLogs } from "./logger.ts";
import { effortEnvPresent } from "./worker.ts";

describe("로그 보관 일수", () => {
  it("보관 일수 안의 파일은 남기고 지난 파일만 지운다(14 → 30일 전 삭제, 120 → 유지)", () => {
    const now = new Date("2020-06-01T00:00:00Z");
    const make = () => {
      const dir = mkdtempSync(join(tmpdir(), "yj-logs-"));
      const old = join(dir, "worker-2020-05-02.log");
      writeFileSync(old, "{}\n");
      const t = new Date(now.getTime() - 30 * 86_400_000);
      utimesSync(old, t, t);
      writeFileSync(join(dir, "worker-2020-05-31.log"), "{}\n");
      return dir;
    };
    const d14 = make();
    expect(pruneLogs(d14, 14, now)).toBe(1);
    expect(readdirSync(d14)).toEqual(["worker-2020-05-31.log"]);
    const d120 = make();
    expect(pruneLogs(d120, 120, now)).toBe(0);
    expect(readdirSync(d120)).toHaveLength(2);
  });
});

describe("CLAUDE_CODE_EFFORT_LEVEL 유무", () => {
  it("값이 아니라 있음/없음만", () => {
    expect(effortEnvPresent({})).toBe(false);
    expect(effortEnvPresent({ CLAUDE_CODE_EFFORT_LEVEL: "" })).toBe(false);
    expect(effortEnvPresent({ CLAUDE_CODE_EFFORT_LEVEL: "high" })).toBe(true);
  });
});
