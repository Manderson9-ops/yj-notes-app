// 운영 D1 백업 (관리자 PC 전용, docs/09 O-05). 결과는 저장소 밖 DATA_DIR/backups/d1 에만 쓴다(S1 포함).
// 사용: npm run backup:prod   (DATA_DIR·wrangler 로그인 필요)
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const dataDir = process.env.DATA_DIR;
if (!dataDir) {
  console.error("DATA_DIR 환경 변수가 필요합니다(백업은 저장소 밖에만 저장).");
  process.exit(1);
}
const outDir = join(dataDir, "backups", "d1");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `yj-notes-db_${new Date().toISOString().slice(0, 10)}.sql`);
const r = spawnSync("npx", ["wrangler", "d1", "export", "DB", "--remote", "--output", out], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("백업 저장:", out);
console.log("복구 절차: docs/09 §5-1 (앱 표는 tools/admin/backup-extract.py 로 추출)");
