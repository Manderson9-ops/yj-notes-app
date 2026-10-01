// 가드 실행 오케스트레이션: 모드별 파일 수집 → 검사 → 결과 집계.
// Orchestration: collect files per mode, run checks, aggregate results.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
  decode,
  isScannableText,
  listBundleFiles,
  loadDenylist,
  parseAllowlist,
  type CheckId,
  type Finding,
  type GuardFile,
  type Notice,
} from "./checks.ts";
import { BUNDLE_ALLOWLIST_FILE } from "./config.ts";

export type Mode = "staged" | "all" | "bundle";

export interface RunOptions {
  mode: Mode;
  /** git 저장소 루트(staged/all) 또는 번들 디렉터리(bundle). */
  root: string;
  /** 가드 설정 파일이 있는 저장소 루트(허용 목록 위치). 기본 root. */
  repoRoot?: string;
  dataDir?: string | undefined;
  /** G6 실행 여부(테스트에서 끈다). */
  runGitleaks?: boolean;
}

export interface RunResult {
  findings: Finding[];
  notices: Notice[];
  /** 검사별 상태. */
  status: Record<CheckId, "pass" | "fail" | "skip">;
  filesChecked: number;
}

const CHECK_IDS: CheckId[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];

function git(args: string[], cwd: string): Buffer {
  const r = spawnSync("git", args, { cwd, maxBuffer: 1024 * 1024 * 512 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} 실패 / failed: ${r.stderr.toString("utf8").trim()}`);
  }
  return r.stdout;
}

function splitZ(b: Buffer): string[] {
  return b
    .toString("utf8")
    .split("\0")
    .filter((s) => s !== "");
}

export function collectStaged(root: string): GuardFile[] {
  const names = splitZ(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root));
  return names.map((path) => ({ path, content: git(["show", `:${path}`], root) }));
}

export function collectAll(root: string): GuardFile[] {
  const names = splitZ(git(["ls-files", "-z"], root));
  return names.map((path) => {
    const full = join(root, path);
    return {
      path,
      content: existsSync(full) && statSync(full).isFile() ? readFileSync(full) : undefined,
    };
  });
}

function runGitleaksCheck(
  mode: Mode,
  root: string,
  findings: Finding[],
  notices: Notice[],
): boolean {
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (probe.error !== undefined || probe.status !== 0) {
    notices.push({
      level: "info",
      id: "G6",
      message:
        "gitleaks 실행 파일이 PATH 에 없어 건너뜁니다(CI 는 gitleaks 액션이 검사). / gitleaks not on PATH; skipped (CI uses the gitleaks action).",
    });
    return false;
  }
  const args =
    mode === "staged"
      ? ["protect", "--staged", "--no-banner", "--redact"]
      : mode === "all"
        ? ["detect", "--no-banner", "--redact"]
        : ["detect", "--no-git", "--no-banner", "--redact", "--source", root];
  const r = spawnSync("gitleaks", args, {
    cwd: mode === "bundle" ? undefined : root,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    const tail = `${r.stdout}${r.stderr}`.trim().split("\n").slice(-12).join("\n");
    findings.push({
      id: "G6",
      path: "(gitleaks)",
      line: 0,
      message: `gitleaks 가 비밀값 의심 항목을 찾았습니다. / gitleaks reported possible secrets.\n${tail}`,
    });
  }
  return true;
}

export function runGuard(opts: RunOptions): RunResult {
  const findings: Finding[] = [];
  const notices: Notice[] = [];
  const ran = new Set<CheckId>();
  const repoRoot = opts.repoRoot ?? opts.root;
  const dataDir = opts.dataDir !== undefined && opts.dataDir !== "" ? opts.dataDir : undefined;

  const files =
    opts.mode === "staged"
      ? collectStaged(opts.root)
      : opts.mode === "all"
        ? collectAll(opts.root)
        : listBundleFiles(opts.root);

  // G4 준비
  let denyTerms: string[] | null = null;
  if (dataDir === undefined) {
    notices.push({
      level: "info",
      id: "G4",
      message:
        opts.mode === "all"
          ? "DATA_DIR 가 없어 G4(denylist)·G5(실제 문장 대조)를 건너뜁니다(CI 정상). / DATA_DIR unset: G4 and G5 skipped (expected in CI)."
          : "DATA_DIR 가 없어 G4(denylist)·G5(실제 문장 대조)를 건너뜁니다. 로컬 커밋 전에는 DATA_DIR 를 설정하세요. / DATA_DIR unset: G4 and G5 skipped. Set DATA_DIR for local commits.",
    });
  } else {
    const dl = loadDenylist(dataDir);
    if (dl.terms === null) {
      notices.push({
        level: "warn",
        id: "G4",
        message: `denylist 파일이 없습니다(${dl.file}). 만드는 법은 tools/guard/README.md. / denylist file missing; see tools/guard/README.md.`,
      });
    } else {
      denyTerms = dl.terms;
      ran.add("G4");
    }
  }

  // G5 준비
  let index: ReturnType<typeof buildSentenceIndex> | null = null;
  if (dataDir !== undefined) {
    index = buildSentenceIndex(dataDir);
    ran.add("G5");
    if (index.keys.size === 0) {
      notices.push({
        level: "warn",
        id: "G5",
        message:
          "DATA_DIR 에서 대조할 알림장·관측 문장을 찾지 못했습니다(경로 확인). / No source sentences found under DATA_DIR; check the path.",
      });
    } else if (index.stride > 1) {
      notices.push({
        level: "warn",
        id: "G5",
        message: `자료가 커서 색인 간격을 ${index.stride} 로 늘렸습니다(${19 + index.stride}자 이상 일치만 보장). / Index stride raised to ${index.stride} due to memory cap.`,
      });
    }
  }

  // G7 준비
  let allowlist: string[] = [];
  if (opts.mode === "bundle") {
    const f = join(repoRoot, BUNDLE_ALLOWLIST_FILE);
    if (existsSync(f)) allowlist = parseAllowlist(readFileSync(f, "utf8"));
  }

  for (const f of files) {
    if (opts.mode !== "bundle") {
      ran.add("G1");
      ran.add("G2");
      const g1 = checkForbiddenPath(f.path);
      if (g1) findings.push(g1);
      const g2 = checkBinaryFile(f.path);
      if (g2) findings.push(g2);
    } else {
      ran.add("G7");
      findings.push(...checkBundlePath(f.path));
    }
    if (denyTerms !== null && !isScannableText(f.path, f.content)) {
      findings.push(...checkDenylist(f.path, null, denyTerms));
    }
    if (!isScannableText(f.path, f.content)) continue;
    const text = decode(f.content);
    ran.add("G3");
    // 번들(압축된 vendor 코드)은 이메일 패턴을 제외한다. 소스에는 모두 적용.
    findings.push(...checkPatterns(f.path, text, opts.mode === "bundle" ? ["email"] : []));
    if (denyTerms !== null) findings.push(...checkDenylist(f.path, text, denyTerms));
    if (index !== null) findings.push(...checkSentences(f.path, text, index));
    if (opts.mode === "bundle") {
      findings.push(...checkBundleWords(f.path, text));
      findings.push(...checkLongHangul(f.path, text, allowlist));
    }
  }

  if (opts.runGitleaks !== false && runGitleaksCheck(opts.mode, opts.root, findings, notices)) {
    ran.add("G6");
  }

  const status = {} as RunResult["status"];
  for (const id of CHECK_IDS) {
    status[id] = findings.some((x) => x.id === id) ? "fail" : ran.has(id) ? "pass" : "skip";
  }
  return { findings, notices, status, filesChecked: files.length };
}

export function resolveRoot(
  mode: Mode,
  bundleDir: string | undefined,
): { root: string; repoRoot: string } {
  const top = git(["rev-parse", "--show-toplevel"], process.cwd()).toString("utf8").trim();
  if (mode === "bundle") return { root: resolve(bundleDir ?? "dist"), repoRoot: top };
  return { root: top, repoRoot: top };
}
