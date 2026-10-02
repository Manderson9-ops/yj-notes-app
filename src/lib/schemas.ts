import { z } from "zod";

/**
 * GET /api/session (docs/05). Client-side copy; to be shared with server/schemas later.
 * pinLength: 서버 PIN_LENGTH 가 유효할 때만 옴(4~12). 이상한 값은 없는 것으로 본다(기존 4~12 + 확인 방식).
 */
export const sessionSchema = z.object({
  authenticated: z.boolean(),
  pinLength: z.number().int().min(4).max(12).optional().catch(undefined),
});
export type Session = z.infer<typeof sessionSchema>;

/** POST /api/session request body. */
export const loginRequestSchema = z.object({ pin: z.string().regex(/^\d{4,12}$/) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Error body shape (docs/05): {error, message}; 429 locked adds retryAfterSec. */
export const errorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  retryAfterSec: z.number().int().nonnegative().optional(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
