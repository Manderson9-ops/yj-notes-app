// 알림장 자동 업데이트 보고 입력 (docs/05 「워커 API」 sync). 본문·이름은 받지 않는다: 상태·단계·코드·건수·날짜뿐.
import { z } from "zod";

export const SYNC_STAGES = [
  "fetch",
  "merge",
  "build",
  "verify",
  "media",
  "downstream",
  "commit",
  "ingest",
  "report",
] as const;

/** ok·no_new 에 붙일 수 있는 코드. */
export const OK_CODES: readonly string[] = ["needs_reading", "guide_asof_due"];

const count = z.number().int().min(0).max(10_000);
const ymd = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

export const SyncStartSchema = z.strictObject({ startedAt: z.iso.datetime({ offset: true }) });

export const SyncFinishSchema = z
  .strictObject({
    status: z.enum(["ok", "no_new", "failed"]),
    stage: z.enum(SYNC_STAGES).optional(),
    code: z
      .string()
      .regex(/^[a-z0-9_]{1,40}$/)
      .optional(),
    newReports: count.optional(),
    newComments: count.optional(),
    lastNoteDate: ymd.optional(),
  })
  .refine((v) => v.status !== "failed" || v.code !== undefined, { path: ["code"] })
  // 성공 실행에는 관리자용 안내 코드 두 가지만 붙일 수 있다(화면에는 나오지 않는다).
  .refine((v) => v.status === "failed" || v.code === undefined || OK_CODES.includes(v.code), {
    path: ["code"],
  })
  .refine((v) => v.status !== "no_new" || (v.newReports ?? 0) === 0, { path: ["newReports"] });

export type SyncFinish = z.infer<typeof SyncFinishSchema>;
