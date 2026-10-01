// 전체 로그아웃(세션 세대 증가) 명령 안내/실행. docs/04 §3, docs/05 "관리".
// 사용:
//   npm run session:revoke -- --local    로컬 D1 에서 실행
//   npm run session:revoke -- --remote   운영 명령을 '출력만' 한다(자동 실행 안 함). 관리자가 직접 실행.
//   npm run session:revoke               두 명령을 모두 출력
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const REVOKE_SQL =
  "UPDATE app_setting SET value = CAST(value AS INTEGER)+1 WHERE key='session_epoch'";

export type Target = "local" | "remote";

/** wrangler 인자 배열(셸을 거치지 않으므로 SQL 인용 문제가 없다). */
export function wranglerArgs(target: Target): string[] {
  return [
    "d1",
    "execute",
    "DB",
    target === "local" ? "--local" : "--remote",
    "--command",
    REVOKE_SQL,
  ];
}

/** 사람이 복사해 실행할 한 줄 명령(PowerShell/bash 공용: SQL 은 큰따옴표로 감쌈). */
export function printableCommand(target: Target): string {
  return `npx wrangler d1 execute DB --${target} --command "${REVOKE_SQL}"`;
}

export function parseArgs(argv: readonly string[]): Target | "both" | "invalid" {
  const flags = argv.filter((a) => a.startsWith("--"));
  const local = flags.includes("--local");
  const remote = flags.includes("--remote");
  if (flags.some((f) => f !== "--local" && f !== "--remote")) return "invalid";
  if (local && remote) return "invalid";
  if (local) return "local";
  if (remote) return "remote";
  return "both";
}

function main(): void {
  const mode = parseArgs(process.argv.slice(2));
  if (mode === "invalid") {
    console.error("사용법: npm run session:revoke -- [--local | --remote]");
    process.exitCode = 1;
    return;
  }
  if (mode === "local") {
    const wrangler = resolve(import.meta.dirname, "../../node_modules/wrangler/bin/wrangler.js");
    const r = spawnSync(process.execPath, [wrangler, ...wranglerArgs("local")], {
      stdio: "inherit",
    });
    process.exitCode = r.status ?? 1;
    return;
  }
  console.log("# 운영 DB 전체 로그아웃 (관리자가 직접 실행):");
  console.log(printableCommand("remote"));
  if (mode === "both") {
    console.log("\n# 로컬 DB: npm run session:revoke -- --local");
    console.log(printableCommand("local"));
  }
}

if (import.meta.main) main();
