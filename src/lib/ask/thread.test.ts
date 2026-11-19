// 대화(T-Q5) 순수 계산 시험: 조회 간격 세 갈래 · 입력 잠금 종류 · 카드 갱신 전후 단계 · 새 질문 초안. 합성 자료만.
import { describe, expect, it } from "vitest";
import { detailPollMs, POLL_IDLE_MS, POLL_MS, POLL_OFFLINE_MS, type AskDetail } from "./api";
import { cardChangeLine, turnCountLine } from "./format";
import {
  cardChange,
  cardLimitReached,
  continueDraft,
  hasRedCardFailed,
  lockKind,
  turnLimitReached,
} from "./thread";

type Turn = AskDetail["turns"][number];
const turn = (over: Partial<Turn> = {}): Turn => ({
  id: 1,
  seq: 1,
  kind: "followup",
  askedBy: "엄마",
  body: "합성 질문",
  reaskReason: null,
  redFlag: false,
  status: "done",
  reply: null,
  reviewScore: null,
  cardStatus: "none",
  cardNote: null,
  cardVersion: null,
  createdAt: "2020-01-15T03:00:00.000Z",
  repliedAt: null,
  ...over,
});

describe("detailPollMs — 조회 간격 세 갈래(+ 첫 질문 경로)", () => {
  it("활성 턴 + 집 PC 켜짐 → 5초(POLL_MS)", () => {
    expect(detailPollMs({ status: "done", threadActive: true, workerOnline: true })).toBe(POLL_MS);
    expect(POLL_MS).toBe(5000);
  });
  it("활성 턴 + 집 PC 꺼짐 → 30초(POLL_OFFLINE_MS)", () => {
    expect(detailPollMs({ status: "done", threadActive: true, workerOnline: false })).toBe(
      POLL_OFFLINE_MS,
    );
    expect(POLL_OFFLINE_MS).toBe(30_000);
  });
  it("끝났고(done) 활성 턴 없음 → 60초(POLL_IDLE_MS), 집 PC 켜짐 여부와 무관", () => {
    expect(detailPollMs({ status: "done", threadActive: false, workerOnline: true })).toBe(
      POLL_IDLE_MS,
    );
    expect(detailPollMs({ status: "done", threadActive: false, workerOnline: false })).toBe(
      POLL_IDLE_MS,
    );
    expect(POLL_IDLE_MS).toBe(60_000);
  });
  it("그 밖은 멈춤: 실패한 질문(활성 턴 없음)", () => {
    expect(detailPollMs({ status: "failed", threadActive: false, workerOnline: true })).toBe(false);
  });
  it("질문이 아직 끝나지 않았으면(pending~reviewing) 지금처럼 5초 — 집 PC 꺼짐이어도 30초로 늘리지 않는다", () => {
    for (const status of ["pending", "claimed", "answering", "reviewing"] as const) {
      expect(detailPollMs({ status, threadActive: false, workerOnline: true })).toBe(POLL_MS);
      expect(detailPollMs({ status, threadActive: false, workerOnline: false })).toBe(POLL_MS);
    }
  });
  it("아직 응답이 없으면(첫 조회 전) 5초", () => {
    expect(detailPollMs(undefined)).toBe(POLL_MS);
  });
});

describe("lockKind — 입력 잠금", () => {
  const d = (turns: Turn[], threadActive = false) => ({ turns, threadActive });
  it("활성 턴 없음 → 잠금 없음", () => {
    expect(lockKind(d([turn()]))).toBeNull();
    expect(lockKind(d([]))).toBeNull();
  });
  it("짧은 답 단계(pending~reviewing) → reply", () => {
    for (const status of ["pending", "claimed", "answering", "reviewing"] as const)
      expect(lockKind(d([turn({ status })]))).toBe("reply");
  });
  it("짧은 답은 끝났고 카드 단계가 도는 중 → card", () => {
    expect(lockKind(d([turn({ status: "done", cardStatus: "pending" })]))).toBe("card");
  });
  it("실패한 턴·카드 failed 는 잠그지 않는다", () => {
    expect(lockKind(d([turn({ status: "failed" })]))).toBeNull();
    expect(lockKind(d([turn({ cardStatus: "failed" })]))).toBeNull();
  });
  it("서버가 threadActive 를 켰는데 목록에서 이유를 못 찾으면 reply", () => {
    expect(lockKind(d([], true))).toBe("reply");
  });
});

describe("한도·위급 실패", () => {
  it("후속 10번이면 한도", () => {
    expect(turnLimitReached({ turnsUsed: 9 })).toBe(false);
    expect(turnLimitReached({ turnsUsed: 10 })).toBe(true);
  });
  it("카드 갱신 3/3 이면 한도", () => {
    expect(cardLimitReached({ cardUpdates: { used: 2, max: 3 } })).toBe(false);
    expect(cardLimitReached({ cardUpdates: { used: 3, max: 3 } })).toBe(true);
  });
  it("위급 턴의 카드가 failed 일 때만 위급 실패", () => {
    expect(hasRedCardFailed({ turns: [turn({ cardStatus: "failed" })] })).toBe(false);
    expect(hasRedCardFailed({ turns: [turn({ redFlag: true, cardStatus: "pending" })] })).toBe(
      false,
    );
    expect(hasRedCardFailed({ turns: [turn({ redFlag: true, cardStatus: "failed" })] })).toBe(true);
  });
});

describe("cardChange — 「카드가 새로 정리됐어요(단계 N → M)」", () => {
  const answer = (level: number | null) => ({
    level,
    createdAt: "x",
    totalMs: 1,
    answer: { level: level ?? 1 } as AskDetail["history"][number]["answer"],
  });
  const hist = (version: number, level: number | null) => ({
    version,
    level,
    createdAt: "x",
    answer: { level: level ?? 1 } as AskDetail["history"][number]["answer"],
  });

  it("가장 최근 갱신: 이력의 마지막 단계 → 지금 단계", () => {
    const t = turn({ id: 5, cardStatus: "done", cardVersion: 2 });
    const d = { history: [hist(1, 5)], answer: answer(7), turns: [t] };
    expect(cardChange(d, t)).toEqual({ from: 5, to: 7 });
  });
  it("카드 번호로 앞뒤 카드를 찾는다(여러 번 갱신된 질문의 옛 턴)", () => {
    const t2 = turn({ id: 2, cardStatus: "done", cardVersion: 2 });
    const t3 = turn({ id: 3, cardStatus: "done", cardVersion: 3 });
    const d = { history: [hist(1, 5), hist(2, 7)], answer: answer(6), turns: [t2, t3] };
    expect(cardChange(d, t2)).toEqual({ from: 5, to: 7 });
    expect(cardChange(d, t3)).toEqual({ from: 7, to: 6 });
  });
  it("카드 번호가 없으면 가장 최근 done 턴만 이력 마지막 → 지금으로 본다", () => {
    const old = turn({ id: 1, cardStatus: "done", cardVersion: null });
    const last = turn({ id: 2, cardStatus: "done", cardVersion: null });
    const d = { history: [hist(1, 4)], answer: answer(6), turns: [old, last] };
    expect(cardChange(d, last)).toEqual({ from: 4, to: 6 });
    expect(cardChange(d, old)).toBeNull();
  });
  it("카드를 갱신하지 않은 턴은 null", () => {
    const t = turn({ cardStatus: "none" });
    expect(cardChange({ history: [], answer: answer(5), turns: [t] }, t)).toBeNull();
    const p = turn({ cardStatus: "pending" });
    expect(cardChange({ history: [], answer: answer(5), turns: [p] }, p)).toBeNull();
  });
  it("단계가 없는 카드(행동 질문이 아님)는 숫자를 null 로 둔다", () => {
    const t = turn({ cardStatus: "done", cardVersion: 2 });
    const d = { history: [hist(1, null)], answer: answer(null), turns: [t] };
    const c = cardChange(d, t);
    expect(c).not.toBeNull();
    expect(cardChangeLine({ from: 1, to: null })).toBe("카드가 새로 정리됐어요");
  });
});

describe("문구 만들기", () => {
  it("카드 변경 줄: 바뀜·그대로", () => {
    expect(cardChangeLine({ from: 5, to: 7 })).toBe("카드가 새로 정리됐어요 (단계 5 → 7)");
    expect(cardChangeLine({ from: 5, to: 5 })).toBe("카드가 새로 정리됐어요 (단계 5 그대로)");
  });
  it("이어서 묻기 N/10", () => {
    expect(turnCountLine(3, 10)).toBe("이어서 묻기 3/10");
  });
  it("새 질문 초안에는 원 질문 링크가 들어간다", () => {
    expect(continueDraft(7, "https://example.test")).toContain("https://example.test/ask/7");
  });
});
