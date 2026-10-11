import type { MockModule } from "./index.ts";
import type { Overview } from "../../src/lib/notesSchemas.ts";
import { MOCK_DAYS, commentCount, firstLineOf } from "./notesData.ts";

/**
 * T-S1 자동 업데이트 상태 합성값. 기본은 어제 저녁 성공(ok). 개발 서버를 `MOCK_SYNC=failed|missed|stuck|none`
 * (+ `MOCK_SYNC_CODE=kidsnote_login` 등)으로 띄우면 그 상태를 보여 준다. e2e 는 page.route 로 바꿔 쓴다.
 */
function syncFixture(): Overview["sync"] {
  const state = process.env.MOCK_SYNC ?? "ok";
  // 고정 시각: 화면 캡처가 실행 시각에 따라 달라지지 않게(어제 저녁 8시 10분 성공).
  const okAt = "2020-05-02T11:10:00.000Z";
  const base = { lastOkAt: okAt, lastAttemptAt: okAt, newReports: 2, lastNoteDate: "2020-05-02" };
  if (state === "none")
    return {
      state: "none",
      lastOkAt: null,
      lastAttemptAt: null,
      newReports: 0,
      lastNoteDate: null,
      code: null,
    };
  if (state === "failed" || state === "missed" || state === "stuck")
    return {
      ...base,
      state,
      code: process.env.MOCK_SYNC_CODE ?? (state === "failed" ? "unknown" : state),
    };
  return { ...base, state: "ok", code: null };
}

/** FAKE /api/overview (합성). 숫자는 합성 알림장 자료에서 센다. 마지막 동기화는 접속 3일 전으로 둔다. */
export const overviewMock: MockModule = {
  prefix: "/api/overview",
  handle(_req, _res, { send }) {
    const recent = [...MOCK_DAYS].reverse().slice(0, 3);
    const body: Overview = {
      noteDays: MOCK_DAYS.length,
      reports: MOCK_DAYS.reduce((n, d) => n + d.items.length, 0),
      comments: MOCK_DAYS.reduce((n, d) => n + commentCount(d), 0),
      range: {
        from: MOCK_DAYS[0]?.date ?? "2020-03-02",
        to: MOCK_DAYS[MOCK_DAYS.length - 1]?.date ?? "2020-03-02",
      },
      ingestState: "idle",
      sync: syncFixture(),
      security: { lastGlobalLockAt: null, failures7d: 0 },
      lastIngest: {
        at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        status: "ok",
        commit: "fixture0000",
      },
      ask: {
        pending: 1,
        worker: { online: true, seenAt: "2020-01-15T00:00:00.000Z" },
        medianTotalMs7d: 150000,
        feedback7d: { up: 3, down: 1, notes: 2 },
      },
      milestones: { observed: 4, unobserved: 6 },
      recentNotes: recent.map((d) => ({
        date: d.date,
        ageMonths: d.ageMonths,
        firstLine: firstLineOf(d),
        nComments: commentCount(d),
      })),
      recentLogs: [],
    };
    send(200, body);
  },
};
