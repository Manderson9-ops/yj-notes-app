// 운영 D1 백업 (관리자 PC 전용, docs/09 O-05). 결과는 저장소 밖 DATA_DIR/backups/d1 에만 쓴다(S1 포함).
// 사용: npm run backup:prod [-- --keep N]   (DATA_DIR·wrangler 로그인 필요, 기본 12개 보관)
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backupPath, exportArgs, parseKeep, selectToDelete } from "./backup-helpers.ts";

const dataDir = process.env.DATA_DIR;
if (!dataDir) {
  console.error("DATA_DIR 환경 변수가 필요합니다(백업은 저장소 밖에만 저장).");
  process.exit(1);
}
const keep = parseKeep(process.argv.slice(2));
if (keep === null) {
  console.error("--keep 은 1 이상의 정수여야 합니다.");
  process.exit(1);
}
const out = backupPath(dataDir, new Date());
const outDir = dirname(out);
mkdirSync(outDir, { recursive: true });

// 셸을 쓰지 않는다(공백 경로 안전). wrangler 는 node 로 직접 실행한다.
// (wrangler 의 package.json exports 가 bin 경로를 막아 require.resolve 대신 설치 위치를 직접 가리킨다.)
const wranglerJs = fileURLToPath(
  new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const r = spawnSync(process.execPath, [wranglerJs, ...exportArgs(out)], {
  stdio: "inherit",
  shell: false,
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("백업 저장:", out);

for (const name of selectToDelete(readdirSync(outDir), keep)) {
  unlinkSync(join(outDir, name));
  console.log("오래된 백업 삭제:", name);
}
console.log("복구 절차: docs/09 §5-1 (앱 표는 tools/admin/backup-extract.py 로 추출)");
