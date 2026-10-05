// 위급 질문(redFlag)에 붙이는 응급처치 틀. 정본은 prompts/emergency.md(공식 지침 요약)이고 파일을 고치지 않는다.
// 절 제목의 「(ref …)」 에서 ref 를 읽어, 질문의 위급 규칙(server/ask/redflags.ts)에 맞는 절만 근거 묶음에 덧붙인다.
// 그 절의 ref 만 tryNow.basis 로 쓸 수 있다(질문 상황과 다른 절은 인용 금지).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMERGENCY_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "emergency.md",
);
export const loadEmergencyMd = (): string => readFileSync(EMERGENCY_FILE, "utf8");

/** redflags.ts 규칙 번호 → 응급 절. (규칙 번호는 RED_FLAG_PATTERNS 의 순서)
 *  숨·호흡·막힘·파래짐·삼킴→A, 의식·깨워도·반응·고열·탈수→B, 경련→C, 약·독→D, 외상·출혈→E, 자해·학대→F, 갑자기 못 함→G */
const RULE_SECTIONS: Record<number, readonly string[]> = {
  0: ["A"],
  1: ["A"],
  2: ["A"],
  3: ["A"],
  4: ["A"],
  5: ["A"],
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
  /** 포함된 절의 ref(허용 basis). */
  refs: string[];
  sections: string[];
}

/** 「## C. 경련 (ref EMERG-SEIZURE)」 → ["EMERG-SEIZURE"] */
export function refsOfHeading(heading: string): string[] {
  const m = /\(ref\s+([^)]+)\)/.exec(heading);
  return m?.[1]
    ? m[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    : [];
}

/** emergency.md 에서 머리말(원칙)과 필요한 절만 골라, 포함된 절의 ref 만 달아 묶음에 붙일 글을 만든다. */
export function buildEmergencySection(md: string, rules: readonly number[]): EmergencySection {
  const sections = sectionsForRules(rules);
  const parts = md.split(/^## /m);
  const rawHead = (parts[0] ?? "").replace(/^# .*\n/, "");
  const picked = parts.slice(1).filter((p) => sections.includes((p[0] ?? "").toUpperCase()));
  const refs = [...new Set(picked.flatMap((p) => refsOfHeading(p.split("\n")[0] ?? "")))];
  // 머리말의 출처 목록은 이번에 포함된 ref 것만 남긴다
  const head = rawHead
    .split("\n")
    .filter((l) => {
      const m = /^- (EMERG-[A-Z0-9-]+):/.exec(l);
      return m?.[1] ? refs.includes(m[1]) : true;
    })
    .join("\n")
    .trim();
  const body = picked.map((p) => {
    const [first = "", ...rest] = p.trim().split("\n");
    const tag = refsOfHeading(first)
      .map((r) => `[ref: ${r}]`)
      .join(" ");
    return [`## ${first}`, tag, ...rest].filter((x) => x !== "").join("\n");
  });
  const text = ["## 위급 처치 틀 (위급 신호가 있는 질문에만 붙어요)", head, ...body].join("\n");
  return { text, refs, sections };
}
