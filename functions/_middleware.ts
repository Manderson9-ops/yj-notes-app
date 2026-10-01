// 모든 응답에 보안 헤더를 붙이고 /api/* 에 세션을 강제한다 (로직은 server/http/guard.ts).
import type { Env } from "../server/env";
import { defaultDeps } from "../server/deps";
import { guardMiddleware } from "../server/http/guard";

export const onRequest: PagesFunction<Env> = (ctx) =>
  guardMiddleware(ctx.request, ctx.env, () => ctx.next(), {
    // T-06 에서 세션 쿠키 검증으로 교체된다. 그 전까지는 fail closed.
    authenticate: () => Promise.resolve(false),
    deps: defaultDeps,
  });
