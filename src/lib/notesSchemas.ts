// 알림장·홈 API 응답 스키마 (docs/05). 서버(server/routes)·mock·화면이 같은 정의를 쓴다.
// Shared by the server routes, the mock API and the UI. Depends on zod only.
import { z } from "zod";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dateString = z.string().regex(DATE_RE);

export const NOTES_QUERY_MAX = 40;
export const NOTES_LIMIT_DEFAULT = 20;
export const NOTES_LIMIT_MAX = 50;

/** GET /notes 쿼리. 빈 문자열은 "없음" 으로 본다. */
export const notesQuerySchema = z.object({
  q: z.string().trim().max(NOTES_QUERY_MAX).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  class: z.string().max(40).optional(),
  cursor: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(NOTES_LIMIT_MAX).default(NOTES_LIMIT_DEFAULT),
});

/** 일치 발췌: text 안의 [start, end) 구간(UTF-16 코드 단위)이 검색어와 일치한다. */
export const noteHitSchema = z.object({
  source: z.enum(["body", "comment"]),
  text: z.string(),
  ranges: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
  /** 발췌 앞/뒤가 잘렸으면 true (화면이 … 를 붙인다) */
  cutStart: z.boolean(),
  cutEnd: z.boolean(),
});
export type NoteHit = z.infer<typeof noteHitSchema>;

export const noteListItemSchema = z.object({
  date: dateString,
  class: z.string(),
  ageMonths: z.number().int(),
  nReports: z.number().int(),
  nComments: z.number().int(),
  firstLine: z.string(),
  hit: noteHitSchema.optional(),
});
export type NoteListItem = z.infer<typeof noteListItemSchema>;

export const notesListSchema = z.object({
  items: z.array(noteListItemSchema),
  nextCursor: dateString.nullable(),
});
export type NotesList = z.infer<typeof notesListSchema>;

export const noteCommentSchema = z.object({
  id: z.number().int(),
  who: z.enum(["parent", "teacher"]),
  postedAt: z.string(),
  body: z.string(),
});
export type NoteComment = z.infer<typeof noteCommentSchema>;

export const noteReportSchema = z.object({
  reportId: z.number().int(),
  authorRole: z.string(),
  direction: z.enum(["to_home", "to_center"]),
  weather: z.string().nullable(),
  postedAt: z.string(),
  body: z.string(),
  comments: z.array(noteCommentSchema),
});
export type NoteReport = z.infer<typeof noteReportSchema>;

export const noteDaySchema = z.object({
  date: dateString,
  class: z.string(),
  ageMonths: z.number().int(),
  items: z.array(noteReportSchema),
  /** 바로 이전(더 오래된) 알림장 날짜. 없으면 null */
  prev: dateString.nullable(),
  /** 바로 다음(더 최근) 알림장 날짜. 없으면 null */
  next: dateString.nullable(),
});
export type NoteDay = z.infer<typeof noteDaySchema>;

export const overviewSchema = z.object({
  noteDays: z.number().int(),
  reports: z.number().int(),
  comments: z.number().int(),
  range: z.object({ from: dateString, to: dateString }).nullable(),
  /** R1-6: 가장 최근 적재 실행 상태. running=갱신 중, failed=마지막 갱신 실패. */
  ingestState: z.enum(["idle", "running", "failed"]),
  /** R1-3: 마지막 전체 잠금(ISO, UTC). 없으면 null. */
  security: z.object({
    lastGlobalLockAt: z.string().nullable(),
    /** R2-1: 최근 7일 PIN 실패 횟수. */
    failures7d: z.number().int(),
  }),
  lastIngest: z
    .object({ at: z.string(), status: z.enum(["ok", "failed", "running"]), commit: z.string() })
    .nullable(),
  /** T-Q 물어보기: 답 기다리는 질문 수, 집 PC 워커 상태(2분 안에 신호가 있으면 online), 최근 7일 답 걸린 시간 중앙값(ms). */
  ask: z.object({
    pending: z.number().int(),
    worker: z.object({ online: z.boolean(), seenAt: z.string().nullable() }),
    medianTotalMs7d: z.number().int().nullable(),
  }),
  milestones: z.object({ observed: z.number().int(), unobserved: z.number().int() }),
  recentNotes: z.array(
    z.object({
      date: dateString,
      ageMonths: z.number().int(),
      firstLine: z.string(),
      nComments: z.number().int(),
    }),
  ),
  recentLogs: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      typeLabel: z.string(),
      occurredOn: dateString,
      recorder: z.string(),
      note: z.string().nullable(),
    }),
  ),
});
export type Overview = z.infer<typeof overviewSchema>;
