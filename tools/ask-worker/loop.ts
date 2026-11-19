// 워커 루프: claim → progress → 파이프라인 → answer 업로드, 실패 시 fail. 네트워크 오류는 지수 백오프.
// 로그인 만료(exitKind=auth, ASK_AUTH_PAUSE=1)면 프로세스를 끝내지 않고 루프 안에서 claim 을 멈추고 시험 호출로만 푼다.
import { ApiError, NetworkError, type AskClient, type ClaimedQuestion } from "./client.ts";
import { ClaudeError, type Probe } from "./claude.ts";
import type { Logger } from "./logger.ts";
import type { CheckIssue } from "./checks.ts";
import { PackError } from "./pack.ts";
import { PipelineError, type PipelineHooks, type PipelineResult } from "./pipeline.ts";

export type Processor = (
  q: ClaimedQuestion,
  hooks: PipelineHooks,
  signal: AbortSignal,
) => Promise<PipelineResult>;

export interface LoopDeps {
  client: AskClient;
  process: Processor;
  log: Logger;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  pollMs: number;
  /** 한 건 처리가 끝난 뒤(성공·실패 모두) 부르는 후처리(의견 요약 파일 갱신 등). 실패해도 루프는 계속한다. */
  afterProcess?: () => Promise<void>;
  heartbeatMs?: number; // 처리 중 리스 연장 간격(0 이면 끔)
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /**
   * 시작·해제 시험 호출(ASK_AUTH_PAUSE=1 일 때만 넘긴다). 있으면 시험 호출이 성공한 뒤에만 claim 하고,
   * 처리 중 auth 실패가 나면 일시정지한다. 없으면 지금처럼 바로 claim 하고 exitKind 기록만 남는다.
   */
  probe?: Probe;
  /** 시작 시험이 auth 아닌 이유로 실패했을 때 다시 시험하기까지(기본 60s). */
  probeRetryMs?: number;
  /** 일시정지 중 시험 간격(기본 10분). */
  authRetryMs?: number;
}

export const PROBE_RETRY_MS = 60_000;
export const AUTH_RETRY_MS = 600_000;

/** 로그용: 「h:forbidden,s:template」처럼 심각도 첫 글자와 범주 이름만(중복 제거). 지적 문장은 넣지 않는다. */
export function issueCategories(issues: readonly CheckIssue[]): string {
  return [...new Set(issues.map((i) => `${i.severity === "hard" ? "h" : "s"}:${i.category}`))].join(
    ",",
  );
}

export function failCodeOf(err: unknown): string {
  if (err instanceof PipelineError || err instanceof PackError || err instanceof ClaudeError)
    return err.code;
  if (err instanceof ApiError) return `upload_${err.status}`;
  return "internal_error";
}

export function backoffMs(attempt: number, base = 2_000, max = 60_000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((res) => {
    if (signal.aborted) {
      res();
      return;
    }
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      res();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** 한 건 처리. 질문이 있었으면 true. */
export async function handleOne(
  deps: LoopDeps,
  signal: AbortSignal,
): Promise<{ claimed: boolean; netError: boolean; authFailed?: true }> {
  const { client, log } = deps;
  let q: ClaimedQuestion | null;
  try {
    q = await client.claim(signal);
  } catch (e) {
    if (signal.aborted) return { claimed: false, netError: false };
    log("claim_error", { kind: e instanceof ApiError ? `api_${e.status}` : "network" });
    return { claimed: false, netError: true };
  }
  if (!q) return { claimed: false, netError: false };

  const started = Date.now();
  log("claimed", { id: q.id, redFlag: q.redFlag });
  let hbStatus: "answering" | "reviewing" = "answering";
  const hb =
    (deps.heartbeatMs ?? 60_000) > 0
      ? setInterval(() => {
          client.progress(q.id, hbStatus).catch(() => undefined);
        }, deps.heartbeatMs ?? 60_000)
      : undefined;
  let netError = false;
  let authFailed = false;
  try {
    const result = await deps.process(
      q,
      {
        onAnswering: async () => {
          hbStatus = "answering";
          await client.progress(q.id, "answering");
        },
        onReviewing: async () => {
          hbStatus = "reviewing";
          await client.progress(q.id, "reviewing");
        },
        onStage: (stage, ms) => {
          log("stage", { id: q.id, stage, ms });
        },
        // 결정적 검사 지적은 범주 이름만 기록한다(문장·질문·답은 남기지 않는다).
        onCheckIssues: (stage, issues) => {
          if (issues.length > 0) {
            log("check_issues", {
              id: q.id,
              stage,
              cats: issueCategories(issues),
              hard: issues.filter((i) => i.severity === "hard").length,
            });
          }
        },
      },
      signal,
    );
    // 업로드: 네트워크 오류는 3번까지 다시 시도
    let uploaded = false;
    for (let i = 1; i <= 3 && !uploaded; i++) {
      try {
        await client.answer(q.id, {
          level: result.level,
          answer: result.answer,
          reviewScore: result.reviewScore,
          model: result.model,
          workMs: Math.round(Date.now() - started),
        });
        uploaded = true;
      } catch (e) {
        if (!(e instanceof NetworkError) || i === 3) throw e;
        await deps.sleep(backoffMs(i, deps.backoffBaseMs, deps.backoffMaxMs), signal);
      }
    }
    log("answered", {
      id: q.id,
      level: result.level,
      score: result.reviewScore,
      rewritten: result.rewritten,
      ms: Date.now() - started,
      packTokens: result.packTokens,
    });
  } catch (e) {
    const code = signal.aborted ? "worker_stopped" : failCodeOf(e);
    netError = e instanceof NetworkError;
    // 실패 종류(usage_limit·auth·overloaded·other)만 남긴다. stderr·질문은 남기지 않는다.
    const exitKind = e instanceof ClaudeError ? e.exitKind : undefined;
    authFailed = !signal.aborted && exitKind === "auth";
    log("failed", { id: q.id, code, ms: Date.now() - started, exitKind });
    try {
      await client.fail(q.id, code);
    } catch {
      log("fail_report_error", { id: q.id });
    }
  } finally {
    if (hb) clearInterval(hb);
  }
  if (deps.afterProcess) {
    try {
      await deps.afterProcess();
    } catch {
      log("after_process_error", { id: q.id });
    }
  }
  return { claimed: true, netError, ...(authFailed ? { authFailed: true as const } : {}) };
}

/** await 사이에 바뀔 수 있는 값이라 함수로 읽는다(타입 좁히기가 이 변화를 모른다). */
const aborted = (s: AbortSignal): boolean => s.aborted;

/** 일시정지: 10분마다 시험 호출, 성공했을 때만 푼다(auth 아닌 실패로는 풀지 않는다). */
async function authPause(deps: LoopDeps, probe: Probe, signal: AbortSignal): Promise<void> {
  deps.log("auth_paused");
  while (!signal.aborted) {
    await deps.sleep(deps.authRetryMs ?? AUTH_RETRY_MS, signal);
    if (aborted(signal)) return;
    if ((await probe(signal)).ok) {
      deps.log("auth_resumed");
      return;
    }
  }
}

/** 시작 시험: 성공해야 claim 을 시작한다. auth 면 일시정지, 그 밖의 실패면 60s 뒤 다시(안내 없이). */
async function startProbe(deps: LoopDeps, probe: Probe, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const r = await probe(signal);
    if (aborted(signal)) return;
    if (r.ok) return;
    if (r.kind === "auth") {
      await authPause(deps, probe, signal);
      return;
    }
    deps.log("probe_failed", { exitKind: r.kind });
    await deps.sleep(deps.probeRetryMs ?? PROBE_RETRY_MS, signal);
  }
}

export async function runLoop(deps: LoopDeps, signal: AbortSignal): Promise<void> {
  let errors = 0;
  deps.log("loop_start", { pollMs: deps.pollMs });
  if (deps.probe) await startProbe(deps, deps.probe, signal);
  while (!signal.aborted) {
    const r = await handleOne(deps, signal);
    if (r.authFailed && deps.probe) {
      await authPause(deps, deps.probe, signal);
      continue;
    }
    if (r.netError) {
      errors += 1;
      await deps.sleep(backoffMs(errors, deps.backoffBaseMs, deps.backoffMaxMs), signal);
      continue;
    }
    errors = 0;
    if (!r.claimed) await deps.sleep(deps.pollMs, signal);
  }
  deps.log("loop_stop");
}
