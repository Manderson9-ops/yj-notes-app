// 사용법 / Usage:
//   node tools/guard/cli.ts --staged        pre-commit: 스테이징된 파일
//   node tools/guard/cli.ts --all           CI: git 추적 파일 전체
//   node tools/guard/cli.ts --bundle <dir>  Q-BUNDLE: 빌드 산출물
import { resolveRoot, runGuard, type Mode } from "./run.ts";

function usage(): never {
  console.error("사용법 / usage: node tools/guard/cli.ts (--staged | --all | --bundle <dir>)");
  process.exit(2);
}

const args = process.argv.slice(2);
let mode: Mode | undefined;
let bundleDir: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--staged") mode = "staged";
  else if (a === "--all") mode = "all";
  else if (a === "--bundle") {
    mode = "bundle";
    bundleDir = args[++i];
    if (bundleDir === undefined) usage();
  } else usage();
}
if (mode === undefined) usage();

const { root, repoRoot } = resolveRoot(mode, bundleDir);
const result = runGuard({ mode, root, repoRoot, dataDir: process.env.DATA_DIR });

console.log(
  `[guard] 모드 ${mode} · 검사 파일 ${result.filesChecked}개 / mode ${mode}, ${result.filesChecked} files`,
);
for (const n of result.notices) {
  console.log(`[guard] ${n.level === "warn" ? "경고 WARN" : "안내 INFO"} ${n.id}: ${n.message}`);
}
for (const f of result.findings) {
  const loc = f.line > 0 ? `${f.path}:${f.line}` : f.path;
  const m = f.masked !== undefined ? `  [일치 match: ${f.masked}]` : "";
  console.log(`✖ ${f.id} ${loc}\n    ${f.message}${m}`);
}

const names: Record<string, string> = {
  G1: "금지 경로",
  G2: "바이너리·문서",
  G3: "주민번호·전화·이메일·URL",
  G4: "denylist(로컬)",
  G5: "실제 문장 대조(로컬)",
  G6: "비밀값(gitleaks)",
  G7: "번들 검사",
};
console.log("\n검사 Check            결과 Result  건수 Count");
for (const [id, st] of Object.entries(result.status)) {
  const count = result.findings.filter((f) => f.id === id).length;
  const label = st === "pass" ? "통과 PASS" : st === "fail" ? "실패 FAIL" : "건너뜀 SKIP";
  console.log(`${id} ${(names[id] ?? "").padEnd(22)} ${label.padEnd(12)} ${count}`);
}

if (result.findings.length > 0) {
  console.log(`\n가드 실패: ${result.findings.length}건 / guard FAILED`);
  process.exit(1);
}
console.log("\n가드 통과 / guard passed");
