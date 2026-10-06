// 질문 확장: 근거 묶음을 만들기 전에 빠른 모델로 검색 낱말·동의어·주제 영역·행동 질문 여부를 뽑는다.
// 실측(이 PC, 같은 플래그): sonnet --effort low 약 4.5~5초, haiku 약 12~19초(haiku 는 오히려 느렸다) → 기본은 sonnet, haiku 는 폴백.
// 질문 글은 데이터다(지시 아님). 실패하면 확장 없이(질문 낱말만으로) 계속한다 — 답 품질은 떨어져도 멈추지는 않는다.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ClaudeRunner } from "./claude.ts";
import { questionBlock, type PromptQuestion } from "./prompts.ts";

/** context.py 의 주제 지도(TOPICS)와 같은 이름. */
export const TOPIC_DOMAINS = [
  "feeding",
  "sleep",
  "tantrum",
  "fear",
  "fluency",
  "media",
  "skill_loss",
  "aggression",
  "toileting",
  "separation",
  "other",
] as const;

export const expansionSchema = z.strictObject({
  keywords: z.array(z.string().min(1).max(20)).max(12),
  synonyms: z.array(z.string().min(1).max(20)).max(20),
  domains: z.array(z.enum(TOPIC_DOMAINS)).max(3),
  topic: z.string().max(40),
  isBehaviorQuestion: z.boolean(),
  /** 질문에 적힌 빈도·지속·영향·공격성(없으면 null). 단계 보정에 쓴다. */
  frequency: z.string().max(40).nullable(),
  duration: z.string().max(40).nullable(),
  impact: z.string().max(60).nullable(),
  aggression: z.string().max(40).nullable(),
});
export type Expansion = z.infer<typeof expansionSchema>;

export const EXPANSION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "keywords",
    "synonyms",
    "domains",
    "topic",
    "isBehaviorQuestion",
    "frequency",
    "duration",
    "impact",
    "aggression",
  ],
  properties: {
    keywords: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 20 },
    },
    synonyms: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 20 },
    },
    domains: { type: "array", maxItems: 3, items: { type: "string", enum: [...TOPIC_DOMAINS] } },
    topic: { type: "string", maxLength: 40 },
    isBehaviorQuestion: { type: "boolean" },
    frequency: { type: ["string", "null"], maxLength: 40 },
    duration: { type: ["string", "null"], maxLength: 40 },
    impact: { type: ["string", "null"], maxLength: 60 },
    aggression: { type: ["string", "null"], maxLength: 40 },
  },
} as const;

/** 확장에 실패했을 때: 행동 질문으로 보고 질문 낱말만 쓴다. */
export const EMPTY_EXPANSION: Expansion = {
  keywords: [],
  synonyms: [],
  domains: [],
  topic: "",
  isBehaviorQuestion: true,
  frequency: null,
  duration: null,
  impact: null,
  aggression: null,
};

export const EXPAND_PROMPT_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "expand.md",
);
export const loadExpandPrompt = (): string => readFileSync(EXPAND_PROMPT_FILE, "utf8");

export interface ExpandOptions {
  runClaude: ClaudeRunner;
  /** 먼저 시도할 모델(기본 sonnet). 실패하면 fallbackModel(기본 haiku)로 한 번 더. */
  model?: string;
  fallbackModel?: string;
  systemPromptFile?: string;
}

export interface ExpandResult {
  expansion: Expansion;
  model: string;
  ok: boolean;
}

const SCHEMA_JSON = JSON.stringify(EXPANSION_JSON_SCHEMA);

export async function expandQuery(
  o: ExpandOptions,
  q: PromptQuestion,
  signal?: AbortSignal,
): Promise<ExpandResult> {
  const models = [o.model ?? "sonnet", o.fallbackModel ?? "haiku"];
  const prompt = [
    questionBlock(q),
    "",
    "위 질문에서 검색 낱말과 주제를 뽑아 JSON 하나를 내요.",
  ].join("\n");
  for (const model of models) {
    try {
      const r = await o.runClaude(
        {
          model,
          effort: "low",
          prompt,
          systemPromptFile: o.systemPromptFile ?? EXPAND_PROMPT_FILE,
          schemaJson: SCHEMA_JSON,
        },
        signal,
      );
      const parsed = expansionSchema.safeParse(r.output);
      if (parsed.success) return { expansion: parsed.data, model, ok: true };
    } catch {
      if (signal?.aborted) break;
      // 다음 모델로
    }
  }
  return { expansion: EMPTY_EXPANSION, model: "none", ok: false };
}
