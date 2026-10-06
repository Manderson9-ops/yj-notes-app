// 집 PC 상주 워커. 사용:
//   node tools/ask-worker/worker.ts                 (루프)
//   node tools/ask-worker/worker.ts --once          (한 건만 claim 해 처리하고 종료)
//   node tools/ask-worker/worker.ts --once --dry-run  (claim 안 함. 합성 질문 + 합성 픽스처로 파이프라인 시험)
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "./client.ts";
import { buildDigest, DIGEST_FILE, writeDigest } from "./digest.ts";
import { createHistoryCache } from "./family.ts";
import { parseHistory, parseReask } from "./inject.ts";
import type { HistoryItem } from "../../shared/ask-schema.ts";
import { createClaudeRunner } from "./claude.ts";
import { askHome, loadConfig, type WorkerConfig } from "./config.ts";
import { abortableSleep, handleOne, runLoop, type LoopDeps } from "./loop.ts";
import { createLogger, pruneLogs } from "./logger.ts";
import { acquireLock } from "./lock.ts";
import { loadEmergencyMd } from "./emergency.ts";
import { expandQuery } from "./expand.ts";
import { buildPack } from "./pack.ts";
import { answerQuestion, type PipelineDeps } from "./pipeline.ts";
import { ANSWER_SCHEMA_FILE, REVIEW_PROMPT_FILE, SYSTEM_PROMPT_FILE } from "./prompts.ts";

// claude CLI 의 검증기는 $schema(2020-12) 키를 모르므로 CLI 로 넘길 때만 제거한다(파일은 draft 2020-12 그대로).
export function cliSchemaJson(fileText: string): string {
  const schema = JSON.parse(fileText) as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$schema")),
  );
}

export const SYNTHETIC_QUESTION =
  "테스트아이가 점심에 밥을 잘 안 먹어요. 며칠째 반만 먹고 남겨요. 어떻게 하면 좋을까요?";

export function makePipelineDeps(
  cfg: WorkerConfig,
  pack: { dataDir: string; ingestRoot?: string; cacheDir: string },
  /** 가족 의견 가져오기(없으면 가족 결과 없이 답한다). */
  getHistory?: () => Promise<HistoryItem[]>,
): PipelineDeps {
  const runClaude = createClaudeRunner({
    bin: cfg.claudeBin,
    home: cfg.home,
    timeoutMs: cfg.claudeTimeoutMs,
  });
  // 질문 확장은 짧은 제한 시간의 빠른 모델 호출(실패해도 확장 없이 계속한다)
  const runExpand = createClaudeRunner({
    bin: cfg.claudeBin,
    home: cfg.home,
    timeoutMs: Math.min(cfg.claudeTimeoutMs, 25_000),
  });
  return {
    runClaude,
    ...(getHistory ? { getHistory } : {}),
    expand: (q, signal) =>
      expandQuery(
        {
          runClaude: runExpand,
          model: cfg.expandModel,
          fallbackModel: cfg.expandModel === "haiku" ? "sonnet" : "haiku",
        },
        q,
        signal,
      ),
    emergencyMd: loadEmergencyMd(),
    today: () => process.env.YJ_TODAY ?? new Date().toISOString().slice(0, 10),
    buildPack: (question, signal, expansion) =>
      buildPack(
        {
          pythonBin: cfg.pythonBin,
          dataDir: pack.dataDir,
          cacheDir: pack.cacheDir,
          ...(pack.ingestRoot ? { ingestRoot: pack.ingestRoot } : {}),
          ...(cfg.birthDate ? { birthDate: cfg.birthDate } : {}),
        },
        question,
        signal,
        expansion,
      ),
    systemPromptFile: SYSTEM_PROMPT_FILE,
    reviewPromptFile: REVIEW_PROMPT_FILE,
    answerSchemaJson: cliSchemaJson(readFileSync(ANSWER_SCHEMA_FILE, "utf8")),
    targetScore: cfg.targetScore,
    minPublishScore: cfg.minPublishScore,
  };
}

/** 합성 DATA_DIR 픽스처를 임시 폴더에 만든다(fixture_builder.py). */
export function makeFixture(pythonBin: string): {
  dataDir: string;
  ingestRoot: string;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "yj-ask-fixture-"));
  const script = fileURLToPath(new URL("./fixture_builder.py", import.meta.url));
  const r = spawnSync(pythonBin, [script, root], {
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1" },
    shell: false,
  });
  if (r.status !== 0) throw new Error("픽스처 생성 실패");
  const j = JSON.parse(r.stdout) as { dataDir: string; ingestRoot: string };
  return { ...j, root };
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}
function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function dryRun(args: string[]): Promise<number> {
  const cfgFile = opt(args, "--config");
  const cfg = loadConfig({ requireToken: false, ...(cfgFile ? { file: cfgFile } : {}) });
  process.env.YJ_TODAY = "2020-03-06"; // 합성 픽스처 날짜에 맞춘다(월령 계산)
  const fx = makeFixture(cfg.pythonBin);
  const cacheDir = join(fx.root, "cache");
  // 시험용 주입: --history <json>(가족 결과) / --reask <json>(다시 답변). 합성 자료만 쓴다.
  const historyPath = opt(args, "--history");
  const reaskPath = opt(args, "--reask");
  const history = historyPath ? parseHistory(readFileSync(historyPath, "utf8")) : null;
  const reask = reaskPath ? parseReask(readFileSync(reaskPath, "utf8"))("dry-run") : undefined;
  const deps = makePipelineDeps(
    cfg,
    { dataDir: fx.dataDir, ingestRoot: fx.ingestRoot, cacheDir },
    history ? () => Promise.resolve(history) : undefined,
  );
  console.log("dry-run: 합성 질문 + 합성 픽스처 (네트워크·claim 없음)");
  let res;
  try {
    res = await answerQuestion(
      deps,
      { body: SYNTHETIC_QUESTION, askedBy: "테스트", redFlag: false, reask },
      {
        onStage: (s, ms) => {
          console.log(`  stage ${s}: ${ms}ms`);
        },
      },
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      level: res.level,
      reviewScore: res.reviewScore,
      rewritten: res.rewritten,
      model: res.model,
      packTokens: res.packTokens,
      timings: res.timings,
    }),
  );
  if (flag(args, "--print-answer")) console.log(JSON.stringify(res.answer, null, 2));
  return 0;
}

export async function main(args: string[]): Promise<number> {
  if (flag(args, "--dry-run")) return await dryRun(args);
  const cfgFile = opt(args, "--config");
  const cfg = loadConfig(cfgFile ? { file: cfgFile } : {});
  if (!cfg.dataDir) throw new Error("DATA_DIR 가 필요해요 (worker.env 또는 환경변수)");
  const home = askHome();
  const log = createLogger(join(home, "logs"), undefined, process.stdout.isTTY);
  pruneLogs(join(home, "logs"));
  const lock = acquireLock(join(home, "worker.lock"));
  if (!lock) {
    log("already_running");
    console.error("이미 실행 중인 워커가 있어요.");
    return 0; // 작업 스케줄러가 재시작 루프를 돌지 않게 정상 종료
  }
  const ac = new AbortController();
  const stop = () => {
    log("stop_signal");
    ac.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGBREAK", stop);
  try {
    const client = createClient({ origin: cfg.origin, token: cfg.token });
    // 가족 의견은 claim 직후 받아 60초 캐시한다. 가져오기에 실패해도 가족 결과 없이 답한다.
    const history = createHistoryCache(() => client.history(60));
    const pipe = makePipelineDeps(
      cfg,
      { dataDir: cfg.dataDir, cacheDir: join(home, "cache") },
      () => history.get(),
    );
    const loopDeps: LoopDeps = {
      client,
      process: (q, hooks, signal) => answerQuestion(pipe, q, hooks, signal),
      // 처리 뒤 로컬 의견 요약 파일 갱신(본문 없음: 개수·질문 번호만)
      afterProcess: async () => {
        const items = await history.get(true);
        writeDigest(join(home, DIGEST_FILE), buildDigest(items, Date.now()));
      },
      log,
      sleep: abortableSleep,
      pollMs: cfg.pollMs,
    };
    if (flag(args, "--once")) {
      const r = await handleOne(loopDeps, ac.signal);
      console.log(r.claimed ? "한 건 처리했어요" : "대기 중인 질문이 없어요");
    } else {
      await runLoop(loopDeps, ac.signal);
    }
    return 0;
  } finally {
    lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      // 메시지에는 경로·설정 안내만 담긴다(질문·토큰 없음)
      console.error(e instanceof Error ? e.message : "워커 오류");
      process.exit(1);
    },
  );
}
