import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../lib/queryClient";
import { syncReason, syncSettingsLine, type SyncInfo } from "../lib/syncText";
import HomePage from "./HomePage";
import { SettingsPage } from "./SettingsPage";

// T-S1: 홈 경고 배너(상태별·적재 배너와 합치기), 설정 한 줄. 합성 값만.
const sync = (over: Partial<SyncInfo>): SyncInfo => ({
  state: "ok",
  lastOkAt: "2030-03-09T11:10:00.000Z", // 한국 3월 9일 20:10
  lastAttemptAt: "2030-03-09T11:00:05.000Z",
  newReports: 3,
  lastNoteDate: "2030-03-07",
  code: null,
  ...over,
});

const overview = (s: SyncInfo, ingestState: "idle" | "running" | "failed" = "idle") => ({
  noteDays: 0,
  reports: 0,
  comments: 0,
  range: null,
  ingestState,
  sync: s,
  security: { lastGlobalLockAt: null, failures7d: 0 },
  lastIngest: null,
  ask: { pending: 0, worker: { online: true, seenAt: null }, medianTotalMs7d: null },
  milestones: { observed: 0, unobserved: 0 },
  recentNotes: [],
  recentLogs: [],
});

function stub(body: unknown) {
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
  vi.unstubAllGlobals();
});

describe("홈: 자동 업데이트 배너", () => {
  it.each([
    ["kidsnote_login", "키즈노트 로그인이 풀렸어요."],
    ["kidsnote_api", "키즈노트 응답이 없어요."],
    ["changed_existing", "예전 알림장이 바뀌어 확인이 필요해요."],
    ["media", "사진 받기가 끝나지 않았어요."],
    ["verify", "자료 검사에서 멈췄어요."],
    ["ingest", "앱에 올리는 중 멈췄어요."],
    ["whatever_new", "관리자 확인이 필요해요."],
  ])("failed(%s): 사유 한 줄 + 마지막 반영 날짜 + 다음 안내", async (code, reason) => {
    stub(overview(sync({ state: "failed", code })));
    renderPage(<HomePage />);
    const box = await screen.findByTestId("sync-notice");
    expect(within(box).getByText("오늘 저녁 알림장 자동 업데이트가 안 됐어요.")).toBeVisible();
    expect(within(box).getByTestId("sync-reason")).toHaveTextContent(reason);
    expect(within(box).getByText("마지막으로 반영된 알림장: 3월 7일")).toBeVisible();
    expect(within(box).getByText("내일 저녁 8시에 다시 해요.")).toBeVisible();
  });

  it("missed: 집 PC 사유", async () => {
    stub(overview(sync({ state: "missed", code: "missed" })));
    renderPage(<HomePage />);
    expect(await screen.findByTestId("sync-reason")).toHaveTextContent(
      "집 PC가 꺼져 있었던 것 같아요.",
    );
  });

  it("stuck: 모르는 사유는 관리자 확인", async () => {
    stub(overview(sync({ state: "stuck", code: "stuck" })));
    renderPage(<HomePage />);
    expect(await screen.findByTestId("sync-reason")).toHaveTextContent("관리자 확인이 필요해요.");
  });

  it("반영 날짜를 모르면 그 줄을 빼고, 알림장 범위 끝 날짜로 대신한다", async () => {
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

  it("적재 실패 배너와 겹치면 동기화 배너 하나만", async () => {
    stub(overview(sync({ state: "failed", code: "ingest" }), "failed"));
    renderPage(<HomePage />);
    await screen.findByTestId("sync-notice");
    expect(screen.queryByText("마지막 갱신이 실패했어요.")).toBeNull();
    expect(document.querySelectorAll('.notice[data-tone="warn"]')).toHaveLength(1);
  });

  it("동기화 정상이면 적재 실패 배너는 그대로", async () => {
    stub(overview(sync({ state: "ok" }), "failed"));
    renderPage(<HomePage />);
    expect(await screen.findByText("마지막 갱신이 실패했어요.")).toBeInTheDocument();
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
  it("매일 저녁 8시 · 마지막 성공 날짜·시각(한국 시간) · 새 알림장 건수", async () => {
    stub(overview(sync({})));
    renderPage(<SettingsPage />);
    expect(await screen.findByTestId("sync-line")).toHaveTextContent(
      "알림장 자동 업데이트: 매일 저녁 8시 · 마지막 성공 3월 9일 20:10(새 알림장 3건)",
    );
  });

  it("실행 기록이 없으면 줄을 보이지 않는다", async () => {
    stub(overview(sync({ state: "none", lastOkAt: null })));
    renderPage(<SettingsPage />);
    await screen.findByText("화면 테마");
    expect(screen.queryByTestId("sync-line")).toBeNull();
  });

  it("실패 상태에서도 마지막 성공 기록을 보여 준다", async () => {
    stub(overview(sync({ state: "failed", code: "media" })));
    renderPage(<SettingsPage />);
    expect(await screen.findByTestId("sync-line")).toHaveTextContent("마지막 성공 3월 9일 20:10");
  });
});

describe("syncText", () => {
  it("한국 시간 날짜 경계: UTC 15:00 이후는 다음 날로 센다", () => {
    expect(syncSettingsLine(sync({ lastOkAt: "2030-03-09T15:30:00.000Z", newReports: 0 }))).toBe(
      "매일 저녁 8시 · 마지막 성공 3월 10일 00:30(새 알림장 0건)",
    );
  });
  it("성공 기록이 없거나 값이 깨졌으면 아직 없어요", () => {
    expect(syncSettingsLine(sync({ lastOkAt: null }))).toContain("아직 없어요");
    expect(syncSettingsLine(sync({ lastOkAt: "깨짐" }))).toContain("아직 없어요");
  });
  it("missed 상태는 코드와 상관없이 missed 문구", () => {
    expect(syncReason(sync({ state: "missed", code: "media" }))).toBe(
      "집 PC가 꺼져 있었던 것 같아요",
    );
  });
});
