import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeConfigPath,
  loadConfig,
  normalizeOrigin,
  parseEnvFile,
  REPO_ROOT,
} from "./config.ts";

const TOKEN = "x".repeat(32);

describe("parseEnvFile", () => {
  it("주석·따옴표·빈 줄", () => {
    expect(parseEnvFile(`# c\nA=1\n\nB="two"\r\nC = 'three'\nbad\n`)).toEqual({
      A: "1",
      B: "two",
      C: "three",
    });
  });
});

describe("normalizeOrigin", () => {
  it("https 만, 로컬은 http 허용", () => {
    expect(normalizeOrigin("https://app.example.test/path")).toBe("https://app.example.test");
    expect(normalizeOrigin("http://localhost:8788")).toBe("http://localhost:8788");
    expect(() => normalizeOrigin("http://app.example.test")).toThrow();
    expect(() => normalizeOrigin("not a url")).toThrow();
  });
});

describe("경로 거부", () => {
  it("저장소 안 경로를 거부한다", () => {
    expect(() => {
      assertSafeConfigPath(join(REPO_ROOT, "worker.env"));
    }).toThrow(/저장소/);
    expect(() => {
      assertSafeConfigPath(join(REPO_ROOT, "tools", "x", "worker.env"));
    }).toThrow(/저장소/);
  });
  it("Google Drive 경로를 거부한다", () => {
    expect(() => {
      assertSafeConfigPath("G:\\내 드라이브\\notes\\worker.env", tmpdir());
    }).toThrow(/Drive/);
    expect(() => {
      assertSafeConfigPath("C:\\Users\\a\\Google Drive\\worker.env", tmpdir());
    }).toThrow(/Drive/);
    expect(() => {
      assertSafeConfigPath("C:\\Users\\a\\My Drive\\worker.env", tmpdir());
    }).toThrow(/Drive/);
  });
  it("안전한 경로는 통과", () => {
    expect(() => {
      assertSafeConfigPath(join(tmpdir(), ".yj-ask", "worker.env"), REPO_ROOT);
    }).not.toThrow();
  });
});

describe("loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "yj-cfg-"));
  mkdirSync(dir, { recursive: true });
  const write = (text: string): string => {
    const f = join(dir, `w-${Math.random().toString(36).slice(2)}.env`);
    writeFileSync(f, text);
    return f;
  };

  it("정상 설정", () => {
    const cfg = loadConfig({
      file: write(
        `APP_ORIGIN=https://app.example.test\nASK_WORKER_TOKEN=${TOKEN}\nASK_POLL_MS=5000\n`,
      ),
      env: {},
    });
    expect(cfg).toMatchObject({
      origin: "https://app.example.test",
      token: TOKEN,
      pollMs: 5000,
      targetScore: 9.5,
    });
  });
  it("토큰·origin 누락과 짧은 토큰은 시작 거부", () => {
    expect(() =>
      loadConfig({ file: write("APP_ORIGIN=https://a.example.test\n"), env: {} }),
    ).toThrow(/TOKEN/);
    expect(() => loadConfig({ file: write(`ASK_WORKER_TOKEN=${TOKEN}\n`), env: {} })).toThrow(
      /APP_ORIGIN/,
    );
    expect(() =>
      loadConfig({
        file: write("APP_ORIGIN=https://a.example.test\nASK_WORKER_TOKEN=short\n"),
        env: {},
      }),
    ).toThrow();
  });
  it("저장소 안 설정 파일은 읽기 전에 거부", () => {
    let read = false;
    expect(() =>
      loadConfig({
        file: join(REPO_ROOT, "worker.env"),
        readFile: () => {
          read = true;
          return "";
        },
      }),
    ).toThrow(/저장소/);
    expect(read).toBe(false);
  });
  it("poll 값은 범위로 제한", () => {
    const cfg = loadConfig({
      file: write(`APP_ORIGIN=https://a.example.test\nASK_WORKER_TOKEN=${TOKEN}\nASK_POLL_MS=1\n`),
      env: {},
    });
    expect(cfg.pollMs).toBe(2000);
  });
});
