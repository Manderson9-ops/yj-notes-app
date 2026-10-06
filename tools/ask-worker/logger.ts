// 로그: id·시간·상태만. 질문·답변 본문은 절대 기록하지 않는다(금지 키 제거 + 값 길이 제한).
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type LogValue = string | number | boolean;
export type LogFields = Record<string, LogValue | undefined>;
export type Logger = (event: string, fields?: LogFields) => void;

const DENY = /body|question|answer|text|summary|prompt|content|token/i;

export function sanitizeFields(fields: LogFields = {}): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || DENY.test(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 60) : v;
  }
  return out;
}

export function createLogger(
  dir: string,
  now: () => Date = () => new Date(),
  echo = false,
): Logger {
  mkdirSync(dir, { recursive: true });
  return (event, fields) => {
    const d = now();
    const line = JSON.stringify({
      ts: d.toISOString(),
      event: event.slice(0, 40),
      ...sanitizeFields(fields),
    });
    try {
      appendFileSync(join(dir, `worker-${d.toISOString().slice(0, 10)}.log`), line + "\n");
    } catch {
      // 로그 실패가 워커를 멈추지 않게 한다
    }
    if (echo) console.log(line);
  };
}

export function pruneLogs(dir: string, keepDays = 14, now: Date = new Date()): number {
  let n = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!/^worker-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = join(dir, f);
      if (now.getTime() - statSync(p).mtimeMs > keepDays * 86_400_000) {
        unlinkSync(p);
        n += 1;
      }
    }
  } catch {
    // 폴더가 없으면 건너뛴다
  }
  return n;
}
