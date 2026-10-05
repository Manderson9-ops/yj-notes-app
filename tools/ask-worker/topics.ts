// 주제 지도(topics.json): context.py 와 같은 파일을 읽는다. 근거 ref 의 주제 판별과 행동 글 대조에 쓴다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Topic {
  label: string;
  words: string[];
  int: string[];
  norm: string[];
  guide: [string, string[] | null][];
  dbwords?: string[];
  note: string;
}

export const TOPICS_FILE = join(dirname(fileURLToPath(import.meta.url)), "topics.json");
export const TOPICS = JSON.parse(readFileSync(TOPICS_FILE, "utf8")) as Record<string, Topic>;

/** 근거 ref 가 속한 주제(INT·NORM 접두어, 주제 가이드 파일). 모르면 null. */
export function refDomain(ref: string): string | null {
  for (const [name, t] of Object.entries(TOPICS)) {
    if ([...t.int, ...t.norm].some((p) => ref.startsWith(p))) return name;
    if (t.guide.some(([prefix]) => ref.startsWith(`guide:${prefix}`))) return name;
  }
  return null;
}

/** 행동 글이 그 주제의 낱말을 직접 담았는가(공백 무시). */
export function textMatchesDomain(text: string, domain: string): boolean {
  const flat = text.replace(/\s+/g, "");
  return (TOPICS[domain]?.words ?? []).some((w) => flat.includes(w.replace(/\s+/g, "")));
}
