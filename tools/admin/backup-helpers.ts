// backup-prod.ts 의 순수 함수(테스트 대상). 실제 자료·파일을 읽지 않는다.
import { join } from "node:path";

export const DEFAULT_KEEP = 12;
/** 이 이름 형식의 파일만 보존 정책(삭제) 대상이다. */
export const BACKUP_NAME = /^yj-notes-db_\d{4}-\d{2}-\d{2}\.sql$/;

export function backupFileName(now: Date): string {
  return `yj-notes-db_${now.toISOString().slice(0, 10)}.sql`;
}

export function backupPath(dataDir: string, now: Date): string {
  return join(dataDir, "backups", "d1", backupFileName(now));
}

/** wrangler 인자 배열(셸을 거치지 않으므로 공백이 든 경로도 그대로 전달된다). */
export function exportArgs(out: string): string[] {
  return ["d1", "export", "DB", "--remote", "--output", out];
}

/** `--keep N` 파싱. 없으면 기본 12, 1 이상의 정수가 아니면 null(오류). */
export function parseKeep(argv: string[]): number | null {
  const i = argv.indexOf("--keep");
  if (i === -1) return DEFAULT_KEEP;
  const raw = argv[i + 1];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** 이름 형식이 맞는 백업 중 최신 keep 개를 남기고 나머지(오래된 순)를 돌려준다. 날짜가 이름에 있어 이름순 = 시간순. */
export function selectToDelete(names: string[], keep: number): string[] {
  const matching = names.filter((n) => BACKUP_NAME.test(n)).sort();
  return matching.slice(0, Math.max(0, matching.length - keep));
}
