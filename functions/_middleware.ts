// 모든 응답에 보안 헤더를 붙이고 /api/* 에 세션을 강제한다 (로직은 server/http/guard.ts).
import { isAuthenticated } from "../server/auth/session";
import { defaultDeps } from "../server/deps";
import type { Env } from "../server/env";
import { guardMiddleware } from "../server/http/guard";

export const onRequest: PagesFunction<Env> = (ctx) =>
  guardMiddleware(ctx.request, ctx.env, () => ctx.next(), {
    authenticate: isAuthenticated,
    deps: defaultDeps,
  });
