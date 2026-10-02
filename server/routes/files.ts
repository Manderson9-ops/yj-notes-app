// /api/files/* — R2 객체 스트리밍 (docs/05). 허용 접두어 `s2/checkup/` 만.
// R2(FILES 바인딩)는 M4 전까지 없다: 바인딩이 없으면 501 로 분명히 알린다(404 와 구분).
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { errorResponse } from "../http/errors";

const ALLOWED_PREFIX = "s2/checkup/";
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/;

export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get("/api/files/*", async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/files/".length));
  } catch {
    return errorResponse(404, "not_found", "찾을 수 없어요.");
  }
  if (!key.startsWith(ALLOWED_PREFIX) || !SAFE_KEY.test(key) || key.includes("..")) {
    return errorResponse(404, "not_found", "찾을 수 없어요.");
  }
  const files = c.env.FILES;
  if (!files || typeof files.get !== "function") {
    return errorResponse(501, "not_implemented", "파일 저장소가 아직 준비되지 않았어요.");
  }
  const obj = await files.get(key);
  if (!obj) return errorResponse(404, "not_found", "찾을 수 없어요.");
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
