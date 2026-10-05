import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeArgs, createClaudeRunner, parseEnvelope } from "./claude.ts";
import { parseGolden } from "./eval.ts";
import { renderMarkdown, summarize, type EvalItem } from "./eval-stats.ts";
import { acquireLock } from "./lock.ts";
import { createLogger, sanitizeFields } from "./logger.ts";
import { buildLauncherVbs, buildTaskXml, utf16le, xmlEscape } from "./scheduler.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "yj-ask-t-"));

describe("claude envelope / args", () => {
  it("structured_output 우선, 없으면 result 를 JSON 으로 파싱", () => {
    const a = parseEnvelope(
      JSON.stringify({
        is_error: false,
        structured_output: { ok: true },
        modelUsage: { "claude-opus-5-5": {} },
      }),
    );
    expect(a).toEqual({ output: { ok: true }, model: "claude-opus-5-5" });
    expect(parseEnvelope(JSON.stringify({ result: '{"n":3}' })).output).toEqual({ n: 3 });
  });
  it("오류 envelope 은 거부", () => {
    expect(() => parseEnvelope(JSON.stringify({ is_error: true }))).toThrow();
    expect(() => parseEnvelope("not json")).toThrow();
    expect(() => parseEnvelope(JSON.stringify({ result: "plain text" }))).toThrow();
  });
  it("측정된 빠른 플래그 조합", () => {
    const a = claudeArgs("m.json", { prompt: "p", systemPromptFile: "s.md", schemaJson: "{}" });
    expect(a).toEqual(
      expect.arrayContaining([
        "-p",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "--no-session-persistence",
        "--json-schema",
        "--system-prompt-file",
      ]),
    );
    expect(a[a.indexOf("--output-format") + 1]).toBe("json");
  });
});

describe("claude runner (가짜 claude 스크립트)", () => {
  const home = tmp();
  const script = join(home, "fake.mjs");
  const run = (body: string, timeoutMs = 10_000) => {
    writeFileSync(script, body);
    return createClaudeRunner({ bin: process.execPath, argsPrefix: [script], home, timeoutMs });
  };
  const req = { prompt: "질문", systemPromptFile: "s.md", schemaJson: "{}" };

  it("stdin 으로 프롬프트를 받고 envelope 을 파싱, API 키 env 는 제거", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-should-not-leak";
    const r = run(`
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        console.log(JSON.stringify({structured_output:{echo:s, key: process.env.ANTHROPIC_API_KEY ?? null, args: process.argv.slice(2)}, modelUsage:{fake:{}}}));
      });`);
    const out = await r(req);
    delete process.env.ANTHROPIC_API_KEY;
    expect(out.model).toBe("fake");
    const o = out.output as { echo: string; key: string | null; args: string[] };
    expect(o.echo).toBe("질문");
    expect(o.key).toBeNull();
    expect(o.args).toContain("--no-session-persistence");
    expect(existsSync(join(home, "empty-mcp.json"))).toBe(true);
  });
  it("비정상 종료·타임아웃·중단", async () => {
    await expect(run("process.exit(3)")(req)).rejects.toMatchObject({ code: "claude_exit" });
    await expect(run("setInterval(()=>{},1000)", 300)(req)).rejects.toMatchObject({
      code: "timeout",
    });
    const ac = new AbortController();
    const p = run("setInterval(()=>{},1000)")(req, ac.signal);
    setTimeout(() => {
      ac.abort();
    }, 100);
    await expect(p).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("lock", () => {
  it("살아 있는 주인이 있으면 null, 죽은 pid 면 인수", () => {
    const f = join(tmp(), "worker.lock");
    const a = acquireLock(f, 111, () => true);
    expect(a).not.toBeNull();
    expect(acquireLock(f, 222, () => true)).toBeNull();
    const b = acquireLock(f, 222, () => false);
    expect(b).not.toBeNull();
    b?.release();
    expect(existsSync(f)).toBe(false);
    a?.release(); // 이미 남의 것이 아니므로 아무 일 없음
  });
  it("release 는 자기 잠금만 지운다", () => {
    const f = join(tmp(), "w.lock");
    const a = acquireLock(f, 1, () => true);
    writeFileSync(f, "999");
    a?.release();
    expect(readFileSync(f, "utf8")).toBe("999");
  });
});

describe("logger", () => {
  it("본문·토큰 류 키를 제거하고 값 길이를 제한", () => {
    const out = sanitizeFields({
      id: 1,
      body: "x",
      question: "q",
      answerText: "a",
      token: "t",
      status: "ok",
      code: "y".repeat(100),
    });
    expect(Object.keys(out).sort()).toEqual(["code", "id", "status"]);
    expect(String(out.code)).toHaveLength(60);
  });
  it("일자별 파일에 한 줄 JSON", () => {
    const dir = tmp();
    const log = createLogger(dir, () => new Date("2020-03-05T01:02:03Z"));
    log("claimed", { id: 9, body: "비밀" });
    const files = readdirSync(dir);
    expect(files).toEqual(["worker-2020-03-05.log"]);
    const text = readFileSync(join(dir, files[0]!), "utf8");
    expect(text).not.toContain("비밀");
    expect(JSON.parse(text.trim())).toMatchObject({ event: "claimed", id: 9 });
  });
});

describe("scheduler 생성물", () => {
  it("작업 XML: 로그온 트리거·숨김·최소 권한·1분 재시작", () => {
    const xml = buildTaskXml("PC\\사용자", "C:\\u\\.yj-ask\\run-worker.vbs");
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<Hidden>true</Hidden>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<Interval>PT1M</Interval>");
    expect(xml).toContain("wscript.exe");
    expect(xml).not.toContain("HighestAvailable");
  });
  it("XML·VBS 이스케이프", () => {
    expect(xmlEscape(`a&b<c>"d"`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;");
    const vbs = buildLauncherVbs(
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\r p\\worker.ts",
      "C:\\r p",
    );
    expect(vbs).toContain(
      String.raw`rc = sh.Run("""C:\Program Files\nodejs\node.exe"" ""C:\r p\worker.ts""", 0, True)`,
    );
    expect(vbs).toContain("WScript.Quit rc");
    expect(utf16le("a").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
  });
});

describe("eval 통계", () => {
  const run = (level: number, score: number) => ({
    level,
    score,
    deductions: {
      factual: 0,
      ungrounded: 0.5,
      safety: 0,
      template: 0,
      record_link: 0,
      over_interpretation: 0,
      style: 0.1,
    },
    totalMs: 60_000,
  });
  const items: EvalItem[] = [
    { id: "g1", runs: [run(4, 9.6), run(5, 9.8)] },
    { id: "g2", runs: [run(3, 9.0), run(6, 9.4)] },
    { id: "g3", runs: [], error: "low_score" },
  ];
  it("평균·최저·단계 일관성(|Δ|≤1)", () => {
    const s = summarize(items);
    expect(s).toMatchObject({
      questions: 3,
      failed: ["g3"],
      minScore: 9,
      levelChecked: 2,
      levelConsistent: 1,
      inconsistentIds: ["g2"],
    });
    expect(s.avgScore).toBe(9.45);
    expect(s.deductionsAvg.ungrounded).toBe(0.5);
    expect(s.deductionsAvg.factual).toBe(0);
  });
  it("markdown 에 질문 본문이 없고 id·점수만", () => {
    const md = renderMarkdown(summarize(items), items, "2020-03-05");
    expect(md).toContain("| g1 | 4 / 5 |");
    expect(md).toContain("일관성 위반: g2");
  });
  it("골든 jsonl 파싱", () => {
    expect(
      parseGolden('{"id":"a","question":"질문"}\n\n{"id":"b","question":"q","redFlag":true}\n'),
    ).toHaveLength(2);
    expect(() => parseGolden('{"id":"","question":"q"}')).toThrow();
  });
});
