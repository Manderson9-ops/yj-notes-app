// 단일 인스턴스 잠금 파일(pid). 살아 있는 pid 가 있으면 시작하지 않는다.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Lock {
  release(): void;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireLock(
  path: string,
  pid: number = process.pid,
  alive: (p: number) => boolean = pidAlive,
): Lock | null {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(pid), { flag: "wx" });
      return {
        release() {
          try {
            if (readFileSync(path, "utf8").trim() === String(pid)) unlinkSync(path);
          } catch {
            // 이미 없음
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const other = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(other) && other !== pid && alive(other)) return null;
      try {
        unlinkSync(path); // 죽은 프로세스의 낡은 잠금
      } catch {
        // 경쟁: 다시 시도
      }
    }
  }
  return null;
}
