// 위급 질문(redFlag)에 붙이는 응급처치 틀. 정본은 prompts/emergency.md(공식 지침 요약)이고, 질문의 위급 규칙(server/ask/redflags.ts)에
// 맞는 절(A~G)만 근거 묶음에 덧붙인다. 출처 ref(EMERG-KDCA-2025, EMERG-KDCA-CHOKE)는 tryNow.basis 로 쓸 수 있다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMERGENCY_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "emergency.md",
);
export const loadEmergencyMd = (): string => readFileSync(EMERGENCY_FILE, "utf8");

export const EMERGENCY_REFS = ["EMERG-KDCA-2025", "EMERG-KDCA-CHOKE"] as const;

/** redflags.ts 규칙 번호 → 응급 절. (규칙 번호는 RED_FLAG_PATTERNS 의 순서) */
const RULE_SECTIONS: Record<number, readonly string[]> = {
  0: ["A", "B"],
  1: ["B"],
  2: ["B"],
  3: ["B"],
  4: ["B"],
  5: ["A", "B"],
  6: ["B"],
  7: ["B"],
  8: ["B"],
  9: ["C"],
  10: ["A", "D"],
  11: ["D"],
  12: ["E"],
  13: ["E"],
  14: ["E"],
  15: ["B"],
  16: ["B"],
  17: ["F"],
  18: ["F"],
  19: ["G"],
  20: ["G"],
};

export function sectionsForRules(rules: readonly number[]): string[] {
  const set = new Set<string>();
  for (const r of rules) for (const s of RULE_SECTIONS[r] ?? []) set.add(s);
  if (set.size === 0) set.add("B"); // 규칙을 모르면 가장 일반적인 위급 틀
  return [...set].sort();
}

export interface EmergencySection {
  text: string;
  refs: string[];
  sections: string[];
}

/** emergency.md 에서 머리말(원칙·출처)과 필요한 절만 골라 묶음에 붙일 글을 만든다. */
export function buildEmergencySection(md: string, rules: readonly number[]): EmergencySection {
  const sections = sectionsForRules(rules);
  const parts = md.split(/^## /m);
  const head = (parts[0] ?? "").replace(/^# .*\n/, "").trim();
  const body = parts
    .slice(1)
    .filter((p) => sections.includes((p[0] ?? "").toUpperCase()))
    .map((p) => `## ${p.trim()}`);
  const text = [
    "## 위급 처치 틀 (위급 신호가 있는 질문에만 붙어요)",
    "[ref: EMERG-KDCA-2025] [ref: EMERG-KDCA-CHOKE]",
    head,
    ...body,
  ].join("\n");
  return { text, refs: [...EMERGENCY_REFS], sections };
}
