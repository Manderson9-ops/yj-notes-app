// Hono 앱 (모든 /api/* 라우트). 인증은 functions/_middleware.ts 가 앞단에서 강제한다.
// Hono app for /api/*. Auth/headers are enforced by the Pages middleware in front of it.
import { Hono } from "hono";
import { defaultDeps, type Deps } from "./deps";
import type { Env } from "./env";
import { errorResponse, toErrorResponse } from "./http/errors";
import { checkupRoutes } from "./routes/checkups";
import { fileRoutes } from "./routes/files";
import { growthRoutes } from "./routes/growth";
import { reportRoutes } from "./routes/reports";
import { sessionRoutes } from "./routes/session";

export interface AppVariables {
  deps: Deps;
}
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}

export function createApp(deps: Deps = defaultDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.onError((e, c) => toErrorResponse(e, c.req.method, new URL(c.req.url).pathname));
  app.notFound(() => errorResponse(404, "not_found", "찾을 수 없어요."));

  app.route("/", sessionRoutes);
  app.route("/", reportRoutes);
  app.route("/", checkupRoutes);
  app.route("/", growthRoutes);
  app.route("/", fileRoutes);

  return app;
}
