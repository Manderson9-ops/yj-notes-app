import { describe, expect, it } from "vitest";
import { ClaudeError, withExitRetry, type ClaudeRunner } from "./claude.ts";

describe("withExitRetry", () => {
  const ok = { output: { a: 1 }, model: "m", ms: 1 };
  it("claude_exit 는 한 번만 다시 시도해요", async () => {
    let n = 0;
    const run: ClaudeRunner = () =>
      ++n === 1 ? Promise.reject(new ClaudeError("claude_exit")) : Promise.resolve(ok);
    await expect(withExitRetry(run, 0)({ prompt: "p" } as never)).resolves.toEqual(ok);
    expect(n).toBe(2);
  });
  it("두 번 연속 실패하면 오류를 올려요", async () => {
    let n = 0;
    const run: ClaudeRunner = () => {
      n++;
      return Promise.reject(new ClaudeError("claude_exit"));
    };
    await expect(withExitRetry(run, 0)({ prompt: "p" } as never)).rejects.toThrow("claude_exit");
    expect(n).toBe(2);
  });
  it("다른 오류는 다시 시도하지 않아요", async () => {
    let n = 0;
    const run: ClaudeRunner = () => {
      n++;
      return Promise.reject(new ClaudeError("claude_timeout"));
    };
    await expect(withExitRetry(run, 0)({ prompt: "p" } as never)).rejects.toThrow("claude_timeout");
    expect(n).toBe(1);
  });
});
