// 보고서·문서 (F1, docs/05). 목록·메타·원문(raw). 세션은 앞단 미들웨어가 강제한다.
// raw: 마크다운은 text/markdown 원문, HTML 은 보고서 전용 CSP(reportCsp) + sandbox iframe 용.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { errorResponse, jsonResponse } from "../http/errors";
import { reportCsp } from "../http/headers";
import { docSummary } from "../../src/lib/docSummary";

const SLUG = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);

interface ReportRow {
  slug: string;
  title: string;
  kind: "html" | "markdown";
  generated_at: string;
  source_commit: string;
  verify_ok: number;
}

export type ReportGroup = "report" | "guide" | "wiki";

/**
 * slug 의 첫 마디(-·_ 로 나눈)가 `guide`/`wiki` 면 그 묶음, 아니면 보고서. 스키마를 바꾸지 않는 규칙(docs/03·05).
 * 적재 도구가 slug 를 `<폴더>-<번호|이름>` 으로 만든다(tools/ingest/model.py doc_slug). 가운데 마디는 보지 않는다
 * (보고서 `report-behavior-guide` 가 가이드로 잘못 묶이지 않게).
 */
export function reportGroup(slug: string): ReportGroup {
  const first = slug.toLowerCase().split(/[-_]/)[0];
  if (first === "guide") return "guide";
  if (first === "wiki") return "wiki";
  return "report";
}

/**
 * 목록 카드의 설명(R1-10): 적재가 미리 계산해 둔 report_doc.summary 를 쓴다.
 * summary 가 NULL(이전에 적재된 행)일 때만 본문 앞부분을 읽어 예전 방식으로 만든다(HTML 은 스타일이 길어 더 읽는다).
 * summary 가 있는 행은 본문(최대 수십 KB)을 읽지 않는다.
 */
const HEAD_SQL =
  "CASE WHEN summary IS NULL THEN substr(body, 1, CASE kind WHEN 'html' THEN 30000 ELSE 1500 END) END AS head, summary";

function toMeta(r: ReportRow) {
  return {
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    group: reportGroup(r.slug),
    generatedAt: r.generated_at,
    sourceCommit: r.source_commit,
    verifyOk: r.verify_ok === 1,
  };
}

function withSummary(r: ReportRow & { head: string | null; summary: string | null }) {
  const summary = r.summary ?? docSummary(r.kind, r.head ?? "");
  return { ...toMeta(r), summary };
}

const COLUMNS = "slug, title, kind, generated_at, source_commit, verify_ok";

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.get("/api/reports", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS}, ${HEAD_SQL} FROM report_doc ORDER BY generated_at DESC, slug ASC`,
  ).all<ReportRow & { head: string | null; summary: string | null }>();
  return jsonResponse(200, { items: results.map(withSummary) });
});

reportRoutes.get("/api/reports/:slug", async (c) => {
  const slug = SLUG.safeParse(c.req.param("slug"));
  if (!slug.success) return errorResponse(404, "not_found", "찾을 수 없어요.");
  const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM report_doc WHERE slug = ?`)
    .bind(slug.data)
    .first<ReportRow>();
  if (!row) return errorResponse(404, "not_found", "찾을 수 없어요.");
  return jsonResponse(200, { ...toMeta(row), rawPath: `/api/reports/${row.slug}/raw` });
});

reportRoutes.get("/api/reports/:slug/raw", async (c) => {
  const slug = SLUG.safeParse(c.req.param("slug"));
  if (!slug.success) return errorResponse(404, "not_found", "찾을 수 없어요.");
  const row = await c.env.DB.prepare("SELECT kind, r2_key, body FROM report_doc WHERE slug = ?")
    .bind(slug.data)
    .first<{ kind: "html" | "markdown"; r2_key: string; body: string | null }>();
  if (!row) return errorResponse(404, "not_found", "찾을 수 없어요.");

  let text = row.body;
  if (text === null) {
    // 본문이 D1 에 없으면 R2. R2 는 M4 전까지 없을 수 있다(env.ts).
    const files = c.env.FILES;
    if (!files || typeof files.get !== "function") {
      return errorResponse(404, "not_found", "문서 본문이 아직 없어요.");
    }
    const obj = await files.get(row.r2_key);
    if (!obj) return errorResponse(404, "not_found", "문서 본문이 아직 없어요.");
    text = await obj.text();
  }

  if (row.kind === "html") {
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // 이 경로의 응답만 reportCsp 를 쓸 수 있다(headers.ts). iframe sandbox="allow-scripts" 로만 띄운다.
        "Content-Security-Policy": reportCsp,
      },
    });
  }
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});
