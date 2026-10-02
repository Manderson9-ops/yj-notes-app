import type { MockModule } from "./index.ts";
import { buildHit } from "../../src/lib/noteHit.ts";
import type { NoteDay, NoteListItem } from "../../src/lib/notesSchemas.ts";
import { MOCK_CLASS, MOCK_DAYS, commentCount, firstLineOf } from "./notesData.ts";

/**
 * FAKE /api/notes (합성 자료). 서버 라우트와 같은 응답 형태·같은 발췌 함수를 쓴다.
 * 시험용 트리거: q=오류시험 -> 500 (화면의 오류 상태 확인용).
 */
const DESC = [...MOCK_DAYS].reverse();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function search(day: NoteDay, q: string): NoteListItem["hit"] | null {
  for (const r of day.items) {
    const h = buildHit(r.body, q, "body");
    if (h) return h;
  }
  for (const r of day.items) {
    for (const c of r.comments) {
      const h = buildHit(c.body, q, "comment");
      if (h) return h;
    }
  }
  return null;
}

export const notesMock: MockModule = {
  prefix: "/api/notes",
  handle(_req, _res, { subPath, query, send }) {
    if (subPath !== "") {
      const date = subPath.slice(1);
      if (!DATE_RE.test(date)) {
        send(400, { error: "bad_request", message: "날짜 형식이 올바르지 않아요." });
        return;
      }
      const i = MOCK_DAYS.findIndex((d) => d.date === date);
      const day = MOCK_DAYS[i];
      if (!day) {
        send(404, { error: "not_found", message: "그날 알림장이 없어요." });
        return;
      }
      send(200, {
        ...day,
        prev: MOCK_DAYS[i - 1]?.date ?? null,
        next: MOCK_DAYS[i + 1]?.date ?? null,
      });
      return;
    }

    const q = (query.get("q") ?? "").trim();
    if (q.length > 40) {
      send(400, { error: "bad_request", message: "검색 조건이 올바르지 않아요." });
      return;
    }
    if (q === "오류시험") {
      send(500, { error: "internal", message: "잠시 후 다시 시도해 주세요." });
      return;
    }
    const from = query.get("from");
    const to = query.get("to");
    const cursor = query.get("cursor");
    const cls = query.get("class");
    const limit = Math.min(50, Math.max(1, Number(query.get("limit") ?? 20) || 20));

    const hits = new Map<string, NoteListItem["hit"]>();
    const rows = DESC.filter((d) => {
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      if (cursor && d.date >= cursor) return false;
      if (cls && cls !== MOCK_CLASS) return false;
      if (q === "") return true;
      const h = search(d, q);
      if (h) hits.set(d.date, h);
      return h !== null;
    });
    const page = rows.slice(0, limit);
    const items: NoteListItem[] = page.map((d) => {
      const hit = hits.get(d.date);
      return {
        date: d.date,
        class: d.class,
        ageMonths: d.ageMonths,
        nReports: d.items.length,
        nComments: commentCount(d),
        firstLine: firstLineOf(d),
        ...(hit ? { hit } : {}),
      };
    });
    send(200, {
      items,
      nextCursor: rows.length > limit ? (page[page.length - 1]?.date ?? null) : null,
    });
  },
};
