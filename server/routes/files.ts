// /api/files/* — R2 객체 스트리밍 (docs/05). 허용 접두어 `s2/checkup/` 만.
// R2(FILES 바인딩)는 M4 전까지 없다: 바인딩이 없으면 501 로 분명히 알린다(404 와 구분).
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { errorResponse } from "../http/errors";

const ALLOWED_PREFIX = "s2/checkup/";
/** 내보낼 수 있는 형식(R1-9). 그 밖의 Content-Type 은 열지 않는다(스크립트가 실릴 수 있는 형식 차단). */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
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
  // 매개변수(; charset=…)를 뗀 형식이 허용 목록에 있어야 한다. 없거나 다르면 415(내용은 내보내지 않는다).
  const type = (obj.httpMetadata?.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_TYPES.has(type)) {
    return errorResponse(415, "unsupported_media_type", "열 수 없는 파일 형식이에요.");
  }
  // 키는 SAFE_KEY 로 영문·숫자·_ . / - 만 허용했으므로 파일 이름에 따옴표·줄바꿈이 들어갈 수 없다.
  const filename = key.slice(key.lastIndexOf("/") + 1);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
