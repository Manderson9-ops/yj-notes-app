import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import {
  syncHead,
  syncNextLine,
  syncReason,
  syncSettingsLine,
  syncWhoLine,
  type SyncInfo,
} from "../lib/syncText";
import HomePage from "./HomePage";
import { SettingsPage } from "./SettingsPage";

// T-S1: 홈 경고 배너(상태별·시각별 문구·쌓이지 않기), 설정 한 줄. 합성 값만.
const at = (iso: string): number => Date.parse(iso);
// 2030-03-10 21:40 KST. 오늘 저녁 8시(11:00Z) 실행이 이미 돌았어야 하는 때.
const NIGHT = "2030-03-10T12:40:00.000Z";
// 2030-03-10 19:00 KST (저녁 8시 전)
const DAYTIME = "2030-03-10T10:00:00.000Z";

const sync = (over: Partial<SyncInfo>): SyncInfo => ({
  state: "ok",
  lastOkAt: "2030-03-09T11:10:00.000Z", // 한국 3월 9일 저녁 8시 10분
  lastAttemptAt: "2030-03-10T11:00:05.000Z",
  newReports: 3,
  lastNoteDate: "2030-03-07",
  code: null,
  ...over,
});

const overview = (
  s: SyncInfo,
  ingestState: "idle" | "running" | "failed" = "idle",
  lastIngestAt: string | null = null,
) => ({
  noteDays: 0,
  reports: 0,
  comments: 0,
  range: null,
  ingestState,
  sync: s,
  security: { lastGlobalLockAt: null, failures7d: 0 },
  lastIngest: lastIngestAt ? { at: lastIngestAt, status: "ok", commit: "fixture0000" } : null,
  ask: { pending: 0, worker: { online: true, seenAt: null }, medianTotalMs7d: null },
  milestones: { observed: 0, unobserved: 0 },
  recentNotes: [],
  recentLogs: [],
});

function stub(body: unknown, now = NIGHT) {
  vi.spyOn(Date, "now").mockReturnValue(at(now));
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}
function renderPage(ui: React.ReactNode) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("홈: 자동 업데이트 배너", () => {
  it.each([
    ["kidsnote_login", "키즈노트 로그인이 풀렸어요."],
    ["kidsnote_api", "키즈노트 응답이 없어요."],
    ["changed_existing", "예전 알림장이 바뀌었어요(관리자 확인 중)."],
    ["media", "사진 받기가 끝나지 않았어요."],
    ["verify", "자료 검사에서 멈췄어요."],
    ["ingest", "앱에 올리는 중 멈췄어요."],
    ["restore_failed", "관리자 확인이 필요해요."],
    ["internal", "관리자 확인이 필요해요."],
    ["whatever_new", "관리자 확인이 필요해요."],
  ])("failed(%s): 사유·반영 날짜·누가 하는지·다음 안내", async (code, reason) => {
    stub(overview(sync({ state: "failed", code })));
    renderPage(<HomePage />);
    const box = await screen.findByTestId("sync-notice");
    expect(within(box).getByTestId("sync-head")).toHaveTextContent(
      "오늘 저녁 알림장 자동 업데이트가 안 됐어요.",
    );
    expect(within(box).getByTestId("sync-reason")).toHaveTextContent(reason);
    expect(within(box).getByText("가족은 하실 일이 없어요. 관리자가 확인해요.")).toBeVisible();
    expect(within(box).getByText("내일 저녁 8시에 다시 해요.")).toBeVisible();
    expect(box).toHaveTextContent("마지막으로 반영된 알림장: 3월 7일");
  });

  it("의미 구조: role=status, 보이지 않는 「주의:」, 첫 줄만 strong, 날짜는 줄바꿈 없는 span", async () => {
    stub(overview(sync({ state: "failed", code: "media" })));
    renderPage(<HomePage />);
    const box = await screen.findByTestId("sync-notice");
    expect(box).toHaveAttribute("role", "status");
    expect(within(box).getByText(/주의:/)).toHaveClass("sr-only");
    const head = within(box).getByTestId("sync-head");
    expect(head.tagName).toBe("STRONG");
    expect(box.querySelectorAll("strong")).toHaveLength(1);
    expect(within(box).getByText("3월 7일")).toHaveClass("nowrap");
  });

  it("missed: 집 PC 사유와 관리자가 집 PC를 확인", async () => {
    stub(
      overview(
        sync({ state: "missed", code: "missed", lastAttemptAt: "2030-03-09T11:00:05.000Z" }),
      ),
    );
    renderPage(<HomePage />);
    expect(await screen.findByTestId("sync-reason")).toHaveTextContent(
      "집 PC가 꺼져 있었던 것 같아요.",
    );
    expect(screen.getByText("관리자가 집 PC를 확인해요.")).toBeVisible();
    expect(screen.getByTestId("sync-head")).toHaveTextContent("오늘 저녁");
  });

  it("stuck: 너무 오래 걸려 멈췄어요", async () => {
    stub(overview(sync({ state: "stuck", code: "stuck" })));
    renderPage(<HomePage />);
    expect(await screen.findByTestId("sync-reason")).toHaveTextContent(
      "업데이트가 너무 오래 걸려 멈췄어요.",
    );
  });

  it("저녁 8시 전: 어제 저녁 · 오늘 저녁 8시에 다시", async () => {
    stub(
      overview(sync({ state: "failed", code: "media", lastAttemptAt: "2030-03-09T11:00:05.000Z" })),
      DAYTIME,
    );
    renderPage(<HomePage />);
    const box = await screen.findByTestId("sync-notice");
    expect(within(box).getByTestId("sync-head")).toHaveTextContent(
      "어제 저녁 알림장 자동 업데이트가",
    );
    expect(within(box).getByText("오늘 저녁 8시에 다시 해요.")).toBeVisible();
  });

  it("반영 날짜를 모르면 그 줄을 뺀다", async () => {
    stub(overview(sync({ state: "failed", code: "media", lastNoteDate: null })));
    renderPage(<HomePage />);
    const box = await screen.findByTestId("sync-notice");
    expect(within(box).queryByText(/마지막으로 반영된 알림장/)).toBeNull();
  });

  it.each(["ok", "running", "none"] as const)("%s: 배너 없음", async (state) => {
    stub(overview(sync({ state })));
    renderPage(<HomePage />);
    await screen.findByText("아직 알림장이 없어요.");
    expect(screen.queryByTestId("sync-notice")).toBeNull();
  });

  it("쌓이지 않기: 적재 실패·적재 중·14일 경고는 동기화 배너가 있으면 숨긴다", async () => {
    const old = "2030-02-01T00:00:00.000Z";
    stub(overview(sync({ state: "failed", code: "ingest" }), "failed", old));
    renderPage(<HomePage />);
    await screen.findByTestId("sync-notice");
    expect(screen.queryByText("마지막 갱신이 실패했어요.")).toBeNull();
    expect(screen.queryByText(/마지막 동기화가 \d+일 전이에요/)).toBeNull();
    expect(document.querySelectorAll('.notice[data-tone="warn"]')).toHaveLength(1);
  });

  it("쌓이지 않기: 적재 중 안내도 숨긴다", async () => {
    stub(overview(sync({ state: "missed", code: "missed" }), "running"));
    renderPage(<HomePage />);
    await screen.findByTestId("sync-notice");
    expect(screen.queryByText("자료를 갱신하는 중이에요.")).toBeNull();
    expect(document.querySelectorAll(".notice")).toHaveLength(1);
  });

  it("동기화 정상이면 적재 실패·14일 경고는 그대로", async () => {
    stub(overview(sync({ state: "ok" }), "failed", "2030-02-01T00:00:00.000Z"));
    renderPage(<HomePage />);
    expect(await screen.findByText("마지막 갱신이 실패했어요.")).toBeInTheDocument();
    expect(screen.getByText(/마지막 동기화가 \d+일 전이에요/)).toBeInTheDocument();
    expect(screen.queryByTestId("sync-notice")).toBeNull();
  });

  it("sync 필드가 없는 예전 응답도 배너 없이 열린다", async () => {
    const legacy: Record<string, unknown> = overview(sync({}));
    delete legacy.sync;
    stub(legacy);
    renderPage(<HomePage />);
    await screen.findByText("아직 알림장이 없어요.");
    expect(screen.queryByTestId("sync-notice")).toBeNull();
  });
});

describe("설정: 자동 업데이트 한 줄", () => {
  it("앞말 없이: 매일 저녁 8시 · 마지막 성공 날짜 저녁 8시 10분 · 새 알림장 N건", async () => {
    stub(overview(sync({})));
    renderPage(<SettingsPage />);
    const line = await screen.findByTestId("sync-line");
    expect(line).toHaveTextContent(
      "매일 저녁 8시 · 마지막 성공 3월 9일 저녁 8시 10분 · 새 알림장 3건",
    );
    expect(line.textContent).not.toContain("알림장 자동 업데이트:");
    expect(within(line).getByText("3월 9일")).toHaveClass("nowrap");
  });

  it("새 알림장이 0건이면 「새 알림장 없음」", async () => {
    stub(overview(sync({ newReports: 0 })));
    renderPage(<SettingsPage />);
    expect(await screen.findByTestId("sync-line")).toHaveTextContent("· 새 알림장 없음");
  });

  it("실패 상태면 「· 오늘은 안 됐어요」를 덧붙이고 마지막 성공은 그대로", async () => {
    stub(overview(sync({ state: "failed", code: "media" })));
    renderPage(<SettingsPage />);
    const line = await screen.findByTestId("sync-line");
    expect(line).toHaveTextContent(
      "마지막 성공 3월 9일 저녁 8시 10분 · 새 알림장 3건 · 오늘은 안 됐어요",
    );
  });

  it("저녁 8시 전 실패는 「어제는」", async () => {
    stub(
      overview(
        sync({ state: "missed", code: "missed", lastAttemptAt: "2030-03-09T11:00:05.000Z" }),
      ),
      DAYTIME,
    );
    renderPage(<SettingsPage />);
    expect(await screen.findByTestId("sync-line")).toHaveTextContent("· 어제는 안 됐어요");
  });

  it("실행 기록이 없으면 줄을 보이지 않는다", async () => {
    stub(overview(sync({ state: "none", lastOkAt: null })));
    renderPage(<SettingsPage />);
    await screen.findByText("화면 테마");
    expect(screen.queryByTestId("sync-line")).toBeNull();
  });
});

describe("syncText: 시각에 따른 문구", () => {
  const failed = (attempt: string) =>
    sync({ state: "failed", code: "media", lastAttemptAt: attempt });
  // 어제 저녁 실행이 실패한 채로 이어지는 시각들 (어제 8시 5분 시작)
  const yesterday = failed("2030-03-09T11:05:00.000Z");

  it("00:30 KST: 어제 저녁 · 오늘 저녁 8시에 다시", () => {
    const now = at("2030-03-09T15:30:00.000Z");
    expect(syncHead(yesterday, now)).toBe("어제 저녁 알림장 자동 업데이트가 안 됐어요.");
    expect(syncNextLine(yesterday, now)).toBe("오늘 저녁 8시에 다시 해요.");
  });

  it("19:59 KST: 아직 어제 · 오늘 저녁 8시에 다시", () => {
    const now = at("2030-03-10T10:59:00.000Z");
    expect(syncHead(yesterday, now)).toContain("어제 저녁");
    expect(syncNextLine(yesterday, now)).toBe("오늘 저녁 8시에 다시 해요.");
  });

  it("20:00 KST 정각: 오늘 실행이 방금 실패했으면 오늘 저녁 · 내일 저녁 8시에 다시", () => {
    const now = at("2030-03-10T11:00:00.000Z");
    const tonight = failed("2030-03-10T10:55:00.000Z"); // 30분 일찍 시작한 수동 실행도 오늘 것
    expect(syncHead(tonight, now)).toBe("오늘 저녁 알림장 자동 업데이트가 안 됐어요.");
    expect(syncNextLine(tonight, now)).toBe("내일 저녁 8시에 다시 해요.");
  });

  it("20:00 KST 정각인데 어제 실패만 남은 경우는 어제 · 곧 다시", () => {
    const now = at("2030-03-10T11:00:00.000Z");
    expect(syncHead(yesterday, now)).toContain("어제 저녁");
    expect(syncNextLine(yesterday, now)).toBe("곧 다시 해요.");
  });

  it("21:31 KST: 오늘 저녁 · 내일 저녁 8시에 다시", () => {
    const now = at("2030-03-10T12:31:00.000Z");
    const tonight = failed("2030-03-10T11:05:00.000Z");
    expect(syncHead(tonight, now)).toBe("오늘 저녁 알림장 자동 업데이트가 안 됐어요.");
    expect(syncNextLine(tonight, now)).toBe("내일 저녁 8시에 다시 해요.");
    const missed = sync({
      state: "missed",
      code: "missed",
      lastAttemptAt: "2030-03-09T11:05:00.000Z",
    });
    expect(syncHead(missed, now)).toContain("오늘 저녁");
  });

  it("누가 하는지·사유 보조 함수", () => {
    expect(syncWhoLine(yesterday)).toBe("가족은 하실 일이 없어요. 관리자가 확인해요.");
    expect(syncWhoLine(sync({ state: "missed" }))).toBe("관리자가 집 PC를 확인해요.");
    expect(syncReason(sync({ state: "missed", code: "media" }))).toBe(
      "집 PC가 꺼져 있었던 것 같아요",
    );
  });

  it("설정 줄: 한국 시간 날짜 경계(UTC 15:00 이후는 다음 날)와 시각 표기", () => {
    const now = at(NIGHT);
    expect(
      syncSettingsLine(sync({ lastOkAt: "2030-03-09T15:30:00.000Z", newReports: 0 }), now),
    ).toBe("매일 저녁 8시 · 마지막 성공 3월 10일 새벽 12시 30분 · 새 알림장 없음");
    expect(syncSettingsLine(sync({ lastOkAt: "2030-03-09T05:00:00.000Z" }), now)).toContain(
      "오후 2시 · 새 알림장 3건",
    );
  });

  it("성공 기록이 없거나 값이 깨졌으면 아직 없어요", () => {
    expect(syncSettingsLine(sync({ lastOkAt: null }), at(NIGHT))).toContain("아직 없어요");
    expect(syncSettingsLine(sync({ lastOkAt: "깨짐" }), at(NIGHT))).toContain("아직 없어요");
  });
});
