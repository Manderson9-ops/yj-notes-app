import type { MockModule } from "./index.ts";
import type { Overview } from "../../src/lib/notesSchemas.ts";
import { MOCK_DAYS, commentCount, firstLineOf } from "./notesData.ts";

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
      security: { lastGlobalLockAt: null, failures7d: 0 },
      lastIngest: {
        at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        status: "ok",
        commit: "fixture0000",
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
