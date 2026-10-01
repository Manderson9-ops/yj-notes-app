import { z } from "zod";

/** GET /api/session (docs/05). Client-side copy; to be shared with server/schemas later. */
export const sessionSchema = z.object({ authenticated: z.boolean() });
export type Session = z.infer<typeof sessionSchema>;

/** POST /api/session request body. */
export const loginRequestSchema = z.object({ pin: z.string().regex(/^\d{4,12}$/) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Error body shape (docs/05): {error, message}; 429 locked adds retryAfterSec. */
export const errorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  retryAfterSec: z.number().int().nonnegative().optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
