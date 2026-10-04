// 자료실·검진·성장 API (T-C2). 합성 fixture(fixtures/seed/library_health.sql)로 검사한다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ageInMonths, lmsPercentile, normalCdf } from "../lib/growth";
import { CSP, reportCsp } from "../http/headers";
import { TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";
import { reportGroup } from "./reports";

const FIXTURE = readFileSync(
  resolve(import.meta.dirname, "../../fixtures/seed/library_health.sql"),
  "utf8",
);

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = await createHarness();
  h.fake.sqlite.exec(FIXTURE);
  cookie = cookieFrom(await h.login(TEST_PIN));
});

const get = (path: string) => h.authedGet(path, cookie);

describe("GET /api/reports", () => {
  it("lists documents newest first with group, without bodies", async () => {
    const res = await get("/api/reports");
    expect(res.status).toBe(200);
    const body = await res.json<{ items: Record<string, unknown>[] }>();
    expect(body.items.map((i) => i.slug)).toEqual([
      "wiki-terms",
      "guide-routine",
      "report-summary",
    ]);
    expect(body.items.map((i) => i.group)).toEqual(["wiki", "guide", "report"]);
    expect(body.items[0]).toMatchObject({ kind: "markdown", verifyOk: false });
    expect(body.items[2]).toMatchObject({ kind: "html", verifyOk: true });
    for (const item of body.items) expect(item).not.toHaveProperty("body");
  });

  it("reportGroup uses the first segment of the slug (ingest: <folder>-<number|name>)", () => {
    expect(reportGroup("guide-05")).toBe("guide");
    expect(reportGroup("wiki_00")).toBe("wiki");
    expect(reportGroup("report-behavior-guide")).toBe("report");
    expect(reportGroup("tracking-index")).toBe("report");
    expect(reportGroup("dev-report-2")).toBe("report");
    expect(reportGroup("guidebook")).toBe("report");
  });
});

describe("GET /api/reports/:slug and /raw", () => {
  it("returns meta with rawPath", async () => {
    const res = await get("/api/reports/guide-routine");
    expect(await res.json()).toMatchObject({
      slug: "guide-routine",
      title: "합성 생활 가이드",
      rawPath: "/api/reports/guide-routine/raw",
    });
  });

  it("404 for unknown or malformed slugs", async () => {
    expect((await get("/api/reports/nope")).status).toBe(404);
    expect((await get("/api/reports/nope/raw")).status).toBe(404);
    expect((await get("/api/reports/..%2Fx/raw")).status).toBe(404);
  });

  it("serves markdown as plain text with the default CSP", async () => {
    const res = await get("/api/reports/guide-routine/raw");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(await res.text()).toContain("## 하루 흐름 살피기");
  });

  it("serves HTML with the report-only CSP (sandbox iframe use)", async () => {
    const res = await get("/api/reports/report-summary/raw");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toBe(reportCsp);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.text()).toContain("<script>");
  });

  it("404 when the body is missing and no R2 is bound", async () => {
    h.fake.sqlite.exec("UPDATE report_doc SET body = NULL WHERE slug = 'wiki-terms'");
    const res = await get("/api/reports/wiki-terms/raw");
    expect(res.status).toBe(404);
  });

  it("falls back to R2 when body is NULL and FILES exists", async () => {
    h.fake.sqlite.exec("UPDATE report_doc SET body = NULL WHERE slug = 'wiki-terms'");
    h.env.FILES = {
      get: () => Promise.resolve({ text: () => Promise.resolve("# R2 본문") }),
    } as unknown as R2Bucket;
    const res = await get("/api/reports/wiki-terms/raw");
    expect(await res.text()).toBe("# R2 본문");
    h.env.FILES = {
      get: () => Promise.resolve(null),
    } as unknown as R2Bucket;
    expect((await get("/api/reports/wiki-terms/raw")).status).toBe(404);
  });
});

describe("GET /api/checkups", () => {
  it("lists checkups newest first with measurements and no image", async () => {
    const res = await get("/api/checkups");
    const body = await res.json<{
      items: {
        id: number;
        imageUrl: unknown;
        remarks: string | null;
        measurements: { measure: string; readStatus: string; sheetPct: number | null }[];
      }[];
    }>();
    expect(body.items.map((i) => i.id)).toEqual([102, 101]);
    expect(body.items.every((i) => i.imageUrl === null)).toBe(true);
    expect(body.items[0]?.remarks).toBeNull();
    const first = body.items[1];
    expect(first?.measurements.map((m) => m.measure)).toEqual([
      "height_cm",
      "weight_kg",
      "head_cm",
      "bmi",
    ]);
    const head = first?.measurements.find((m) => m.measure === "head_cm");
    expect(head).toMatchObject({ readStatus: "UNCERTAIN", sheetPct: null });
    // 가정에서 잰 값(검진 없음)은 검진 카드에 섞이지 않는다
    expect(body.items.flatMap((i) => i.measurements)).toHaveLength(8);
  });

  it("returns one checkup, 404 otherwise", async () => {
    const ok = await get("/api/checkups/101");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      id: 101,
      ageMonths: 4,
      overall: "합성 종합 문구 예시 1",
    });
    expect((await get("/api/checkups/999")).status).toBe(404);
    expect((await get("/api/checkups/abc")).status).toBe(404);
    expect((await get("/api/checkups/0")).status).toBe(404);
  });
});

describe("GET /api/growth", () => {
  it("returns points with computed age and the reference curve", async () => {
    const res = await get("/api/growth?measure=height_cm");
    expect(res.status).toBe(200);
    const body = await res.json<{
      sex: string;
      referenceSource: string;
      points: Record<string, unknown>[];
      reference: { ageMonth: number; p3: number; p50: number; p97: number }[];
    }>();
    expect(body.sex).toBe("F");
    expect(body.referenceSource).toBe("SYNTH-LMS");
    expect(body.points.map((p) => [p.date, p.ageMonths, p.value])).toEqual([
      ["2020-05-20", 4, 62.5],
      ["2020-09-12", 7, 68.4],
      ["2021-01-20", 12, 74.6],
      ["2021-07-20", 18, 81],
    ]);
    // 결과지 백분위는 원본 그대로, 없으면 null
    expect(body.points.map((p) => p.sheetPct)).toEqual([55, null, null, 45]);
    expect(body.reference[0]).toMatchObject({ ageMonth: 0 });
    expect(body.reference.at(-1)?.ageMonth).toBe(24);
    for (const r of body.reference) expect(r.p3 < r.p50 && r.p50 < r.p97).toBe(true);
    // 기준표에 그 개월 행이 있을 때만(12·18개월) 재계산값이 있다
    expect(body.points.map((p) => p.recalcPct === null)).toEqual([true, true, false, false]);
  });

  it("maps head_cm to the head_circ_cm rows, keeps UNCERTAIN status", async () => {
    const body = await (
      await get("/api/growth?measure=head_cm")
    ).json<{
      points: { readStatus: string; sheetPct: number | null }[];
    }>();
    expect(body.points).toHaveLength(2);
    expect(body.points[0]).toMatchObject({ readStatus: "UNCERTAIN", sheetPct: null });
  });

  it("works for weight_kg and bmi, rejects other measures", async () => {
    for (const m of ["weight_kg", "bmi"]) {
      const res = await get(`/api/growth?measure=${m}`);
      expect(res.status).toBe(200);
      expect((await res.json<{ points: unknown[] }>()).points.length).toBeGreaterThan(0);
    }
    expect((await get("/api/growth?measure=foo")).status).toBe(400);
    expect((await get("/api/growth")).status).toBe(400);
  });

  it("falls back to the checkup's own month count without a birth date", async () => {
    h.fake.sqlite.exec("DELETE FROM app_setting WHERE key = 'child_birth_date'");
    const body = await (
      await get("/api/growth?measure=height_cm")
    ).json<{
      points: { ageMonths: number | null }[];
    }>();
    expect(body.points.map((p) => p.ageMonths)).toEqual([4, null, null, 18]);
  });
});

describe("GET /api/files/*", () => {
  it("404 outside the allowed prefix, 501 when R2 is not bound", async () => {
    expect((await get("/api/files/other/a.jpg")).status).toBe(404);
    expect((await get("/api/files/s2/checkup/../x")).status).toBe(404);
    expect((await get("/api/files/s2/checkup/a.jpg")).status).toBe(501);
  });

  it("streams an allowed object when R2 is bound", async () => {
    h.env.FILES = {
      get: (key: string) =>
        Promise.resolve(
          key === "s2/checkup/a.jpg"
            ? { body: "bytes", httpMetadata: { contentType: "image/jpeg" } }
            : null,
        ),
    } as unknown as R2Bucket;
    const ok = await get("/api/files/s2/checkup/a.jpg");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(ok.headers.get("Content-Disposition")).toBe('inline; filename="a.jpg"');
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await get("/api/files/s2/checkup/missing.jpg")).status).toBe(404);
  });

  it("R1-9: only jpeg/png/webp/pdf are served; anything else (html, svg, none) is 415", async () => {
    const bind = (contentType: string | undefined) => {
      h.env.FILES = {
        get: () =>
          Promise.resolve({
            body: "bytes",
            httpMetadata: contentType === undefined ? {} : { contentType },
          }),
      } as unknown as R2Bucket;
    };
    for (const [key, type] of [
      ["a.png", "image/png"],
      ["b.webp", "image/webp"],
      ["c.pdf", "application/pdf"],
      ["d.jpg", "image/jpeg; charset=binary"],
    ] as const) {
      bind(type);
      const res = await get(`/api/files/s2/checkup/${key}`);
      expect(res.status, type).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(type.split(";")[0]);
      expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="${key}"`);
    }
    for (const type of [
      "text/html",
      "image/svg+xml",
      "application/octet-stream",
      "application/javascript",
      "",
      undefined,
    ]) {
      bind(type);
      const res = await get("/api/files/s2/checkup/e.jpg");
      expect(res.status, String(type)).toBe(415);
      expect(res.headers.get("Content-Disposition")).toBeNull();
      expect(await res.json()).toEqual({
        error: "unsupported_media_type",
        message: "열 수 없는 파일 형식이에요.",
      });
    }
  });

  it("R1-9: Content-Disposition uses only the basename", async () => {
    h.env.FILES = {
      get: () => Promise.resolve({ body: "x", httpMetadata: { contentType: "image/png" } }),
    } as unknown as R2Bucket;
    const res = await get("/api/files/s2/checkup/sub/dir/scan-1.png");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="scan-1.png"');
  });
});

describe("growth helpers", () => {
  it("ageInMonths counts completed months", () => {
    expect(ageInMonths("2020-01-15", "2020-02-14")).toBe(0);
    expect(ageInMonths("2020-01-15", "2020-02-15")).toBe(1);
    expect(ageInMonths("2020-01-15", "2021-07-20")).toBe(18);
    expect(ageInMonths("2020-01-15", "2019-12-31")).toBeNull();
    expect(ageInMonths("bad", "2020-01-01")).toBeNull();
  });

  it("normalCdf and lmsPercentile give known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(lmsPercentile(86.4, 1, 86.4, 0.04)).toBe(50);
    expect(lmsPercentile(10, 0, 10, 0.1)).toBe(50);
    expect(lmsPercentile(80, 1, 86.4, 0.0395)).toBeLessThan(10);
    expect(lmsPercentile(1, null, 1, 1)).toBeNull();
    expect(lmsPercentile(-1, 1, 1, 1)).toBeNull();
  });
});
