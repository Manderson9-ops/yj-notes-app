// 가드 음성 대조(반드시 잡혀야 하는 것) + 양성 대조(통과해야 하는 것). 합성 자료만 사용한다.
// 민감 패턴 문자열은 이 파일이 가드에 걸리지 않도록 조각을 이어 붙여 만든다.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSentenceIndex,
  checkBinaryFile,
  checkBundlePath,
  checkBundleWords,
  checkDenylist,
  checkForbiddenPath,
  checkLongHangul,
  checkPatterns,
  checkSentences,
  mask,
  parseDenylist,
} from "./checks.ts";
import { runGuard } from "./run.ts";

const SENTENCE = "테스트아이가 오늘 블록으로 높은 탑을 쌓았어요 정말 대단해요";
const SENTENCE2 = "테스트아이는 친구A와 함께 기차 놀이를 오래 했어요 신나게 웃었어요";
const RRN = "900101" + "-" + "1234567";
const RRN_MASKED = "900101" + "-" + "1" + "******";
const PHONE = "010" + "-" + "1234" + "-" + "5678";
const EMAIL = "tester" + "@" + "gmail.com";
const KURL = "https://www.kids" + "note.com/service/report/" + "123456";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "guard-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeDataDir(opts: { denylist?: string } = {}): string {
  const dd = join(tmp, "data");
  mkdirSync(join(dd, "alrimjang", "2020-01"), { recursive: true });
  mkdirSync(join(dd, "tracking"), { recursive: true });
  writeFileSync(
    join(dd, "alrimjang", "2020-01", "day.md"),
    `---\ntitle: 합성\n---\n\n오늘의 알림\n${SENTENCE}\n끝.\n`,
  );
  writeFileSync(join(dd, "tracking", "observations.csv"), `date,note\n2020-01-15,"${SENTENCE2}"\n`);
  if (opts.denylist !== undefined) {
    mkdirSync(join(dd, ".guard"), { recursive: true });
    writeFileSync(join(dd, ".guard", "denylist.txt"), opts.denylist);
  }
  return dd;
}

describe("음성 대조: 반드시 잡는다", () => {
  it.each([
    "alrimjang/2020-01/day.md",
    "src/records/a.txt",
    "_source/x.txt",
    "backups/a.json",
    ".ingest/state.json",
    "report/index.html",
    "data/app.sqlite",
    "data/app.sqlite3",
    "local.db",
    ".dev.vars",
    ".env",
    ".env.local",
    "d1-export-2026.sql",
  ])("G1 금지 경로: %s", (p) => {
    expect(checkForbiddenPath(p)?.id).toBe("G1");
  });

  it.each([
    "a.jpg",
    "b.JPEG",
    "c.png",
    "d.pdf",
    "e.xlsx",
    "f.docx",
    "g.mp4",
    "h.zip",
    "docs/x.png",
  ])("G2 바이너리 허용 폴더 밖: %s", (p) => {
    expect(checkBinaryFile(p)?.id).toBe("G2");
  });

  it.each([
    ["주민번호", RRN],
    ["마스킹 주민번호", RRN_MASKED],
    ["휴대전화", PHONE],
    ["이메일", EMAIL],
    ["키즈노트 URL", KURL],
    ["키즈노트 API", "/api/v1/children/" + "42"],
  ])("G3 패턴: %s", (_n, value) => {
    const f = checkPatterns("a.md", `앞\n뒤 ${value} 끝`);
    expect(f).toHaveLength(1);
    expect(f[0]?.id).toBe("G3");
    expect(f[0]?.line).toBe(2);
    // 일치 문자열 전체가 출력에 나오지 않는다
    expect(JSON.stringify(f)).not.toContain(value);
  });

  it("G4 denylist 일치(본문·경로)", () => {
    const terms = parseDenylist("# 주석\n\n테스트이름\n");
    expect(terms).toEqual(["테스트이름"]);
    const body = checkDenylist("a.md", "첫줄\n여기에 테스트이름 이 있다", terms);
    expect(body).toHaveLength(1);
    expect(body[0]?.line).toBe(2);
    expect(body[0]?.id).toBe("G4");
    expect(checkDenylist("docs/테스트이름.md", null, terms)).toHaveLength(1);
  });

  it("G5 알림장 문장 20자 일치(줄바꿈·공백이 달라도)", () => {
    const index = buildSentenceIndex(makeDataDir());
    const reworded =
      "# 제목\n설명입니다.\n테스트아이가   오늘\n블록으로 높은 탑을 쌓았어요 정말 대단해요\n";
    const f = checkSentences("doc.md", reworded, index);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]?.id).toBe("G5");
    expect(f[0]?.line).toBeGreaterThanOrEqual(3);
  });

  it("G5 관측 CSV 문장 일치", () => {
    const index = buildSentenceIndex(makeDataDir());
    expect(checkSentences("x.ts", `const s = "${SENTENCE2}";`, index)).not.toHaveLength(0);
  });

  it("G7 소스맵 파일, 표지어, 한글 장문", () => {
    expect(checkBundlePath("assets/index.js.map")[0]?.id).toBe("G7");
    expect(checkBundleWords("a.js", 'var u="Kids' + 'Note";')[0]?.id).toBe("G7");
    const long = "이것은 번들에 들어가면 안 되는 아주 긴 한글 문장입니다 정말로 그렇습니다";
    expect(long.length).toBeGreaterThanOrEqual(30);
    expect(checkLongHangul("a.js", `x("${long}")`, [])[0]?.id).toBe("G7");
  });

  it("G7 번들 디렉터리 전체 실행(맵+장문+표지어+denylist+문장)", () => {
    const dd = makeDataDir({ denylist: "테스트이름\n" });
    const dist = join(tmp, "dist");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "assets", "a.js.map"), "{}");
    writeFileSync(join(dist, "assets", "a.js"), `x("${SENTENCE}");y("테스트이름");z("kidsnote");`);
    const r = runGuard({
      mode: "bundle",
      root: dist,
      repoRoot: tmp,
      dataDir: dd,
      runGitleaks: false,
    });
    expect(r.status.G7).toBe("fail");
    expect(r.status.G4).toBe("fail");
    expect(r.status.G5).toBe("fail");
    expect(r.findings.filter((f) => f.id === "G7").length).toBeGreaterThanOrEqual(3);
  });

  it("G4 DATA_DIR 설정 + denylist 파일 없음 → 경고(실패 아님)", () => {
    const dd = makeDataDir();
    const root = join(tmp, "dist");
    mkdirSync(root);
    writeFileSync(join(root, "a.js"), "ok");
    const r = runGuard({ mode: "bundle", root, repoRoot: tmp, dataDir: dd, runGitleaks: false });
    expect(r.notices.some((n) => n.id === "G4" && n.level === "warn")).toBe(true);
    expect(r.status.G4).toBe("skip");
  });
});

describe("양성 대조: 통과해야 한다", () => {
  it("허용 이메일", () => {
    const ok = [
      "278173983+someone" + "@users.noreply.github.com",
      "a" + "@example.com",
      "b" + "@example.org",
    ];
    expect(checkPatterns("a.md", ok.join("\n"))).toHaveLength(0);
  });

  it("허용 폴더의 이미지, .env.example", () => {
    expect(checkBinaryFile("public/icons/icon-192.png")).toBeNull();
    expect(checkBinaryFile("docs/img/arch.png")).toBeNull();
    expect(checkBinaryFile("e2e/__screenshots__/home.png")).toBeNull();
    expect(checkForbiddenPath(".env.example")).toBeNull();
    expect(checkForbiddenPath("src/app/main.ts")).toBeNull();
    expect(checkForbiddenPath("fixtures/notes.json")).toBeNull();
  });

  it("짧은 한글 UI 문구와 허용 목록의 긴 문구는 번들 통과", () => {
    expect(checkLongHangul("a.js", 'x("기록 저장")', [])).toHaveLength(0);
    const long = "허용 목록에 명시한 서른 글자가 넘는 안내 문구입니다 계속 읽어 주세요 감사합니다";
    expect(long.length).toBeGreaterThanOrEqual(30);
    expect(checkLongHangul("a.js", `x("${long}")`, [long])).toHaveLength(0);
  });

  it("무관한 문장은 G5 통과", () => {
    const index = buildSentenceIndex(makeDataDir());
    expect(
      checkSentences("a.md", "전혀 다른 내용의 합성 문장을 새로 적어 봅니다 가나다라마바사", index),
    ).toHaveLength(0);
  });

  it("문자 마스킹: 전체를 노출하지 않는다", () => {
    expect(mask(PHONE)).not.toBe(PHONE);
    expect(mask(PHONE)).toContain("*");
    expect(mask("ab")).toBe("**");
  });
});

describe("--staged 통합 (임시 git 저장소)", () => {
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  function sh(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
    return spawnSync(cmd, args, { cwd, encoding: "utf8", env: env ?? process.env });
  }
  function repo(): string {
    const dir = join(tmp, "repo");
    mkdirSync(dir);
    sh("git", ["init", "-q"], dir);
    sh("git", ["config", "user.email", "t" + "@example.com"], dir);
    sh("git", ["config", "user.name", "t"], dir);
    return dir;
  }
  const env = (() => {
    const e = { ...process.env };
    delete e.DATA_DIR;
    return e;
  })();

  it("깨끗한 파일은 통과(exit 0)", () => {
    const dir = repo();
    writeFileSync(join(dir, "a.md"), "합성 문서입니다\n");
    sh("git", ["add", "a.md"], dir);
    const r = sh(process.execPath, [cli, "--staged"], dir, env);
    expect(r.status).toBe(0);
  });

  it("위반 파일은 exit 1, 일치 문자열 전체는 출력하지 않는다", () => {
    const dir = repo();
    writeFileSync(join(dir, ".env"), "X=1\n");
    writeFileSync(join(dir, "note.md"), `연락처 ${PHONE}\n`);
    sh("git", ["add", "-f", ".env", "note.md"], dir);
    const r = sh(process.execPath, [cli, "--staged"], dir, env);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("G1");
    expect(r.stdout).toContain("G3");
    expect(r.stdout).toContain("note.md:1");
    expect(r.stdout).not.toContain(PHONE);
  });

  it("스테이징된 내용 기준으로 검사(작업 트리에서 지워도 잡는다)", () => {
    const dir = repo();
    writeFileSync(join(dir, "n.md"), `메일 ${EMAIL}\n`);
    sh("git", ["add", "n.md"], dir);
    writeFileSync(join(dir, "n.md"), "깨끗해짐\n");
    const r = sh(process.execPath, [cli, "--staged"], dir, env);
    expect(r.status).toBe(1);
  });

  it("DATA_DIR 의 denylist·문장 대조가 staged 에서 동작", () => {
    const dd = makeDataDir({ denylist: "테스트이름\n" });
    const dir = repo();
    writeFileSync(join(dir, "a.md"), "여기 테스트이름 이 있다\n");
    writeFileSync(join(dir, "b.md"), `${SENTENCE}\n`);
    sh("git", ["add", "a.md", "b.md"], dir);
    const r = sh(process.execPath, [cli, "--staged"], dir, { ...env, DATA_DIR: dd });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("G4");
    expect(r.stdout).toContain("G5");
  });
});
