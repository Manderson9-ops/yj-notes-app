// 시험용 가짜 claude(createClaudeRunner 의 argsPrefix 로 node 가 돌린다). 합성 문구만 쓴다.
// 호출마다 계획 파일에서 한 단계를 꺼내 그대로 행동한다:
//   "ok"                  성공 봉투(structured_output {ok:true})
//   "stderr:<문구>"        stderr 에 문구를 쓰고 종료 코드 1
//   "is_error:<문구>"      종료 코드 0, 오류 봉투 {is_error:true, result:<문구>}
//   "exit_envelope:<문구>" 종료 코드 1, stdout 에 오류 봉투(stderr 없음)
//   "hang"                끝나지 않음(시간 초과 시험)
//   "early_exit"          stdin 을 기다리지 않고 곧바로 종료 코드 1(실제 CLI 는 3초 안에 stdin 이 없으면 이렇게 끝난다)
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** exitKind 별 합성 실패 문구(실제 CLI 문구 형태를 흉내 낸 것). */
export const KIND_TEXT = {
  auth: "Invalid API key · Please run /login",
  usage_limit: "Claude AI usage limit reached|1763600000",
  overloaded: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}',
  other: "Something unexpected happened",
} as const;

export interface FakeClaude {
  home: string;
  bin: string;
  argsPrefix: string[];
  setPlan: (steps: string[]) => void;
  /** 지금까지 실행된 단계(호출 순서). */
  calls: () => string[];
}

export function makeFakeClaude(): FakeClaude {
  const home = mkdtempSync(join(tmpdir(), "yj-fake-claude-"));
  const plan = join(home, "plan.json");
  const calls = join(home, "calls.json");
  const script = join(home, "fake.mjs");
  writeFileSync(plan, "[]");
  writeFileSync(calls, "[]");
  writeFileSync(
    script,
    `import { readFileSync, writeFileSync } from "node:fs";
const plan = JSON.parse(readFileSync(${JSON.stringify(plan)}, "utf8"));
const step = plan.shift() ?? "ok";
writeFileSync(${JSON.stringify(plan)}, JSON.stringify(plan));
const calls = JSON.parse(readFileSync(${JSON.stringify(calls)}, "utf8"));
calls.push(step);
writeFileSync(${JSON.stringify(calls)}, JSON.stringify(calls));
const i = step.indexOf(":");
const kind = i < 0 ? step : step.slice(0, i);
const text = i < 0 ? "" : step.slice(i + 1);
if (kind === "early_exit") process.exit(1);
process.stdin.resume();
process.stdin.on("end", () => {
  if (kind === "ok") {
    process.stdout.write(JSON.stringify({ structured_output: { ok: true }, modelUsage: { "fake-model": {} } }) + "\\n", () => process.exit(0));
  } else if (kind === "stderr") {
    process.stderr.write(text, () => process.exit(1));
  } else if (kind === "is_error") {
    process.stdout.write(JSON.stringify({ is_error: true, result: text }) + "\\n", () => process.exit(0));
  } else if (kind === "exit_envelope") {
    process.stdout.write(JSON.stringify({ is_error: true, result: text }) + "\\n", () => process.exit(1));
  } else {
    setInterval(() => {}, 1000);
  }
});
`,
  );
  return {
    home,
    bin: process.execPath,
    argsPrefix: [script],
    setPlan: (steps) => {
      writeFileSync(plan, JSON.stringify(steps));
      writeFileSync(calls, "[]");
    },
    calls: () => JSON.parse(readFileSync(calls, "utf8")) as string[],
  };
}
