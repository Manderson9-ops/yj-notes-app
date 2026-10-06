// 의견 요약 파일(T-Q3 §5-c): 워커가 처리 뒤 %USERPROFILE%\.yj-ask\feedback-digest.json 을 갱신한다.
// 질문·답·메모 본문은 넣지 않는다(개수와 질문 번호만). 관리자(주 1회 루틴)가 이 파일과 원격 D1 을 읽어 요약한다.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HistoryItem } from "../../shared/ask-schema.ts";

export const DIGEST_WINDOW_DAYS = 30;
export const DIGEST_FILE = "feedback-digest.json";

export interface FeedbackDigest {
  /** 만든 시각(ISO). */
  updatedAt: string;
  windowDays: number;
  /** 창 안(최근 30일)에 남은 표·메모 수. */
  up: number;
  down: number;
  notes: number;
  /** 👎 가 있는 질문 번호 / 메모가 있는 질문 번호(본문 없음). */
  downQuestionIds: number[];
  noteQuestionIds: number[];
}

/** 순수 함수: history 항목에서 창 안의 표·메모를 센다. 시각이 읽히지 않는 값은 건너뛴다. */
export function buildDigest(items: readonly HistoryItem[], nowMs: number): FeedbackDigest {
  const since = nowMs - DIGEST_WINDOW_DAYS * 24 * 3600 * 1000;
  const inWindow = (iso: string): boolean => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= since && t <= nowMs + 60_000;
  };
  let up = 0;
  let down = 0;
  let notes = 0;
  const downIds = new Set<number>();
  const noteIds = new Set<number>();
  for (const it of items) {
    for (const v of it.votes) {
      if (!inWindow(v.updatedAt)) continue;
      if (v.helpful) up++;
      else {
        down++;
        downIds.add(it.id);
      }
    }
    for (const n of it.notes) {
      if (!inWindow(n.createdAt)) continue;
      notes++;
      noteIds.add(it.id);
    }
  }
  return {
    updatedAt: new Date(nowMs).toISOString(),
    windowDays: DIGEST_WINDOW_DAYS,
    up,
    down,
    notes,
    downQuestionIds: [...downIds].sort((a, b) => a - b),
    noteQuestionIds: [...noteIds].sort((a, b) => a - b),
  };
}

/** 임시 파일에 쓰고 바꿔 치기(읽는 쪽이 반쯤 쓴 파일을 보지 않게). */
export function writeDigest(path: string, digest: FeedbackDigest): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}
