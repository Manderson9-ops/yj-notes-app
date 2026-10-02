import type { z } from "zod";
import { errorBodySchema } from "./schemas";

/** Typed API error. status 0 means the request never reached the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | undefined;
  /** 422 validation_error: field name -> reason (docs/05). */
  readonly fields: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSec?: number,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
    this.fields = fields;
  }
}

export async function api<S extends z.ZodType>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; schema: S },
): Promise<z.infer<S>>;
export async function api(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options?: { body?: unknown },
): Promise<undefined>;
export async function api(
  method: string,
  path: string,
  options: { body?: unknown; schema?: z.ZodType } = {},
): Promise<unknown> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (options.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "network", "network error");
  }
  if (!res.ok) {
    let parsed: ReturnType<typeof errorBodySchema.safeParse> | undefined;
    try {
      parsed = errorBodySchema.safeParse(await res.json());
    } catch {
      parsed = undefined;
    }
    const body = parsed?.success ? parsed.data : undefined;
    throw new ApiError(
      res.status,
      body?.error ?? "unknown",
      body?.message ?? "",
      body?.retryAfterSec,
      body?.fields,
    );
  }
  if (res.status === 204 || !options.schema) return undefined;
  return options.schema.parse(await res.json());
}
