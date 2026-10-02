import { reportCsp } from "../../server/http/headers.ts";
import { docSummary } from "../../src/lib/docSummary.ts";
import type { MockModule } from "./index.ts";

/** FAKE 자료실 API (합성 자료만). 응답 모양은 server/routes/reports.ts 와 같다. */
const DOCS = [
  {
    slug: "wiki-terms",
    title: "합성 용어 모음",
    kind: "markdown",
    group: "wiki",
    generatedAt: "2020-09-03T00:00:00Z",
    sourceCommit: "fixture0000",
    verifyOk: false,
  },
  {
    slug: "guide-routine",
    title: "합성 생활 가이드",
    kind: "markdown",
    group: "guide",
    generatedAt: "2020-09-02T00:00:00Z",
    sourceCommit: "fixture0000",
    verifyOk: true,
  },
  {
    slug: "report-summary",
    title: "합성 발달 보고서",
    kind: "html",
    group: "report",
    generatedAt: "2020-09-01T00:00:00Z",
    sourceCommit: "fixture0000",
    verifyOk: true,
  },
] as const;

// 목록에는 없는 문서: 가족 기록 경고의 가이드 링크(guide/05#3-1 -> guide-05) 시험용
const GUIDE_05 = {
  slug: "guide-05",
  title: "합성 대응 가이드",
  kind: "markdown",
  group: "guide",
  generatedAt: "2020-09-04T00:00:00Z",
  sourceCommit: "fixture0000",
  verifyOk: true,
} as const;

const para = (n: number) =>
  `${String(n)}번째 문단. 긴 글을 읽을 때는 한 줄이 너무 길지 않아야 눈이 편하다. 큰 글씨로 바꿔도 줄바꿈이 자연스러워야 하고, 목차로 원하는 곳까지 바로 이동할 수 있어야 한다. 이 문장들은 화면 확인용으로 새로 쓴 합성 글이다.`;

const GUIDE_MD = [
  "# 합성 생활 가이드",
  "",
  "이 문서는 화면 시안용 합성 글이다. 실제 가정의 자료와 관계가 없다.",
  "",
  "## 하루 흐름 살피기",
  "",
  para(1),
  "",
  "- 일어난 시각과 잠든 시각",
  "- 식사 때 앉아 있던 시간",
  "- 바깥 놀이를 한 시간",
  "",
  "## 기록 표 예시",
  "",
  "| 항목 | 기록 방법 | 예시 |",
  "| --- | --- | --- |",
  "| 식사 | 먹은 양을 칩으로 고른다 | 조금 |",
  "| 낮잠 | 시작과 끝 시각을 적는다 | 13시~14시 |",
  "",
  "## 도움을 요청할 때",
  "",
  "> 기록은 판단을 내리기 위한 것이 아니라 함께 이야기할 근거를 모으기 위한 것이다.",
  "",
  para(2),
  para(3),
  "상세는 [안내 페이지](https://example.org/guide) 에서 볼 수 있다. [나쁜 링크](javascript:alert(1)) 는 글자로만 보인다.",
  "",
  "<script>alert('이 줄은 글자 그대로 보여야 한다')</script>",
  "",
  "## 점검 목록",
  "",
  "- [x] 잠자리 시각 적기",
  "- [ ] 식사 기록 남기기",
  "- 하루 흐름",
  "  - 아침",
  "  - 저녁  ",
  "    줄바꿈 뒤 이어지는 글",
  "",
  "~~지난 방식~~ 대신 칩으로 고른다.",
  "",
  "<details>",
  "<summary>자세히 보기</summary>",
  "",
  "접어 둔 설명이다. **굵은 `코드` 글자** 도 함께 보인다.",
  "",
  "</details>",
  "",
  "## 용어 메모",
  "",
  "1. 백분위: 같은 나이 아이들을 키 순서로 세웠을 때의 위치를 나타내는 숫자.",
  "2. 개월 수: 생일 기준으로 센 만 개월.",
  "",
  "## 마무리",
  "",
  para(4),
  para(5),
  para(6),
].join("\n");

const GUIDE_05_MD = [
  "# 합성 대응 가이드",
  "",
  "## 3. 합성 상황별 안내",
  "",
  "### 3-1. 합성 상황 하나",
  "",
  para(9),
  "",
  "### 3-2. 합성 상황 둘",
  "",
  para(10),
  para(11),
  para(12),
].join("\n");

const WIKI_MD = [
  "# 합성 용어 모음",
  "",
  "## 성장 곡선",
  "",
  para(7),
  "",
  "## 검진 결과지",
  "",
  para(8),
].join("\n");

const REPORT_HTML = [
  "<!doctype html>",
  '<html lang="ko"><head><meta charset="utf-8"><title>합성 발달 보고서</title>',
  "<style>body{font-family:sans-serif;margin:16px;line-height:1.6}</style></head><body>",
  "<h1>합성 발달 보고서</h1>",
  '<p id="out">스크립트 실행 전</p>',
  '<script>document.getElementById("out").textContent = "스크립트 실행됨";</script>',
  "</body></html>",
].join("\n");

const bodyOf = (slug: string): string =>
  slug === "guide-routine" ? GUIDE_MD : slug === "guide-05" ? GUIDE_05_MD : WIKI_MD;

export const libraryMock: MockModule = {
  prefix: "/api/reports",
  handle(req, res, { subPath, send }) {
    if (req.method !== "GET") {
      send(405, { error: "method_not_allowed", message: "" });
      return;
    }
    if (subPath === "") {
      send(200, {
        items: DOCS.map((d) => ({
          ...d,
          summary: docSummary(d.kind, d.slug === "report-summary" ? REPORT_HTML : bodyOf(d.slug)),
        })),
      });
      return;
    }
    const m = /^\/([^/]+)(\/raw)?$/.exec(subPath);
    const doc = [...DOCS, GUIDE_05].find((d) => d.slug === m?.[1]);
    if (!m || !doc) {
      send(404, { error: "not_found", message: "찾을 수 없어요." });
      return;
    }
    if (!m[2]) {
      send(200, { ...doc, rawPath: `/api/reports/${doc.slug}/raw` });
      return;
    }
    if (doc.kind === "html") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Security-Policy", reportCsp);
      res.end(REPORT_HTML);
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.end(bodyOf(doc.slug));
  },
};
