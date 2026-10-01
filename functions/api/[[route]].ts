// Pages Functions 진입점: 모든 /api/* 를 Hono 앱에 넘긴다 (로직은 server/app.ts).
import { createApp } from "../../server/app";
import type { Env } from "../../server/env";

const app = createApp();

export const onRequest: PagesFunction<Env> = (ctx) => app.fetch(ctx.request, ctx.env);
