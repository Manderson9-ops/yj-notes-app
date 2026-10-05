// 워커 루프: claim → progress → 파이프라인 → answer 업로드, 실패 시 fail. 네트워크 오류는 지수 백오프.
import { ApiError, NetworkError, type AskClient, type ClaimedQuestion } from "./client.ts";
import { ClaudeError } from "./claude.ts";
import type { Logger } from "./logger.ts";
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
  heartbeatMs?: number; // 처리 중 리스 연장 간격(0 이면 끔)
  backoffBaseMs?: number;
  backoffMaxMs?: number;
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
): Promise<{ claimed: boolean; netError: boolean }> {
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
    log("failed", { id: q.id, code, ms: Date.now() - started });
    try {
      await client.fail(q.id, code);
    } catch {
      log("fail_report_error", { id: q.id });
    }
  } finally {
    if (hb) clearInterval(hb);
  }
  return { claimed: true, netError };
}

export async function runLoop(deps: LoopDeps, signal: AbortSignal): Promise<void> {
  let errors = 0;
  deps.log("loop_start", { pollMs: deps.pollMs });
  while (!signal.aborted) {
    const r = await handleOne(deps, signal);
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
