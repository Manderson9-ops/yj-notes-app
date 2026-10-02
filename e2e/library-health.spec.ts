import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// T-C2: 자료실(S40·S41), 검진(S42), 성장 곡선(S43). FAKE mock API 의 합성 자료만 쓴다.

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

async function openLibrary(page: Page) {
  await login(page);
  await page.getByRole("link", { name: "자료", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "자료" })).toBeVisible();
}

test("자료 목록 → 마크다운 문서 열기 → 목차 점프", async ({ page }, info) => {
  await openLibrary(page);
  for (const g of ["건강 기록", "보고서", "가이드", "위키"]) {
    await expect(page.getByRole("heading", { level: 2, name: g })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /검진 결과/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /성장 곡선/ })).toBeVisible();
  // 검증 배지는 통과가 아닐 때만 보인다(통과는 모든 문서가 같아 소음). 카드에는 설명 한 줄이 있다.
  await expect(page.getByRole("link", { name: /합성 용어 모음/ })).toContainText("검증 미통과");
  await expect(page.getByRole("link", { name: /합성 생활 가이드/ })).not.toContainText("검증");
  await expect(page.getByRole("link", { name: /합성 생활 가이드/ })).toContainText(
    "이 문서는 화면 시안용 합성 글이다.",
  );
  await expect(page.getByText("자료를 마지막으로 갱신한 날: 2020년 9월 3일 (목)")).toBeVisible();
  if (info.project.name === "mobile-chromium")
    await stableShot(page, "flow-library-list-basic-light");

  await page.getByRole("link", { name: /합성 생활 가이드/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "합성 생활 가이드" })).toBeVisible();
  // 같은 제목의 `# ` 는 한 번만 보인다
  await expect(page.getByRole("heading", { name: "합성 생활 가이드" })).toHaveCount(1);

  // 원시 HTML 은 글자 그대로, 안전하지 않은 링크는 링크가 아니다
  await expect(page.getByText("<script>alert(", { exact: false })).toBeVisible();
  await expect(page.locator("article script")).toHaveCount(0);
  const ext = page.getByRole("link", { name: /안내 페이지/ });
  await expect(ext).toHaveAttribute("rel", "noopener noreferrer");
  await expect(ext).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: /나쁜 링크/ })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();

  // 읽기 좋은 줄 길이: 본문 폭이 38em 을 넘지 않는다
  const ratio = await page.evaluate(
    "(() => { const a = document.querySelector('.doc-body'); const fs = parseFloat(getComputedStyle(a).fontSize); return a.getBoundingClientRect().width / fs; })()",
  );
  expect(ratio).toBeLessThanOrEqual(38.01);

  // 목차: 마지막 항목으로 점프하면 그 제목이 화면에 들어오고 포커스를 받는다
  await page.getByText(/^목차/).click();
  await page.getByRole("button", { name: "마무리" }).click();
  const target = page.getByRole("heading", { level: 2, name: "마무리" });
  await expect(target).toBeInViewport();
  await expect(target).toBeFocused();
  if (info.project.name === "mobile-chromium")
    await stableShot(page, "flow-library-doc-basic-light");

  await page.getByRole("link", { name: "← 자료" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "자료" })).toBeVisible();
});

test("HTML 문서는 sandbox iframe 안에서 열린다", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("link", { name: /합성 발달 보고서/ }).click();
  const iframe = page.locator("iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts"); // allow-same-origin 없음
  await expect(iframe).toHaveAttribute("src", "/api/reports/report-summary/raw");
  const body = page.frameLocator("iframe").locator("#out");
  await expect(body).toHaveText("스크립트 실행됨");
  // opaque origin: 쿠키·저장소에 닿으면 SecurityError (allow-same-origin 없음)
  await expect(
    page.frameLocator("iframe").locator("body").evaluate("document.cookie"),
  ).rejects.toThrow();
});

test("없는 문서는 이유와 함께 알려 준다", async ({ page }) => {
  await login(page);
  await page.goto("/library/doc/nope");
  await expect(page.getByRole("alert")).toContainText("찾을 수 없는 자료예요.");
  await expect(page.getByRole("link", { name: "← 자료" })).toBeVisible();
});

test("가이드 링크 주소(guide-05#3-1): 해당 절로 이동, 없는 절은 처음부터 + 안내", async ({
  page,
}) => {
  await login(page);
  await page.goto("/library/doc/guide-05#3-1");
  const target = page.getByRole("heading", { level: 3, name: /^3-1\./ });
  await expect(target).toBeInViewport();
  await expect(target).toBeFocused();
  await expect(page.getByText("가리킨 절이 없어요")).toHaveCount(0);

  await page.goto("/library/doc/guide-05#9-9");
  await expect(page.getByRole("heading", { level: 1, name: "합성 대응 가이드" })).toBeVisible();
  await expect(page.getByText("가리킨 절이 없어요. 처음부터 보여요.")).toBeVisible();
});

test("검진: 결과지 문구 그대로, 판독 불확실 배지 설명", async ({ page }, info) => {
  await openLibrary(page);
  await expect(page.getByRole("link", { name: /검진 결과/ })).toContainText("검진 2건");
  await page.getByRole("link", { name: /검진 결과/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "검진" })).toBeVisible();

  const card = page.getByRole("article").filter({ hasText: "합성 1차 (4~6개월용)" });
  await expect(card).toContainText("2020년 5월 20일 (수)");
  await expect(card).toContainText("4개월");
  await expect(card).toContainText("합성 종합 문구 예시 1");
  await expect(card).toContainText("합성 참고 문구 예시 1");
  await expect(card).toContainText("합성 발달 문구 예시 1");
  const rows = card.getByRole("row");
  await expect(rows.filter({ hasText: "키" })).toContainText("62.5 cm");
  await expect(rows.filter({ hasText: "키" })).toContainText("55");
  await expect(rows.filter({ hasText: "머리둘레" })).toContainText("판독 불확실");
  await expect(card.getByRole("alert").or(card.locator(".notice"))).toContainText(
    "원본 결과지와 맞춰 봐 주세요",
  );
  // 두 번째 검진에는 불확실 값이 없다
  const card2 = page.getByRole("article").filter({ hasText: "합성 5차 (18~24개월용)" });
  await expect(card2.getByText("판독 불확실")).toHaveCount(0);
  await expect(page.locator('[data-tone="serious"]').first()).toBeVisible();
  // 판정 어휘가 없다
  const text = await page.locator("main").innerText();
  for (const w of ["정상", "지연", "달성", "미달", "잘했"]) expect(text).not.toContain(w);
  if (info.project.name === "mobile-chromium") {
    await stableShot(page, "flow-checkups-basic-light", true);
  }
});

test("성장 곡선: 탭 전환, 점 선택, 표 보기", async ({ page }, info) => {
  await openLibrary(page);
  await page.getByRole("link", { name: /성장 곡선/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "성장 곡선" })).toBeVisible();

  const tabs = page.getByRole("group", { name: "측정 종류" });
  await expect(tabs.getByRole("button", { name: "키" })).toHaveAttribute("aria-pressed", "true");
  const chart = page.getByRole("group", { name: "키 성장 곡선 그래프" });
  await expect(chart).toBeVisible();
  await expect(chart.getByRole("button")).toHaveCount(4);
  await expect(page.getByText("점을 누르면 값과 측정 조건을 볼 수 있어요.")).toBeVisible();
  await expect(page.getByText("기준표 출처: SYNTH-LMS")).toBeVisible();

  // 점 선택 -> 값·날짜·측정 조건
  await chart.getByRole("button", { name: /2020년 9월 12일/ }).click();
  const detail = page.locator(".card[aria-live]");
  await expect(detail).toContainText("2020년 9월 12일 (토)");
  await expect(detail).toContainText("68.4 cm");
  await expect(detail).toContainText("7개월");
  await expect(detail).toContainText("집에서 측정");
  await expect(detail).toContainText("결과지 백분위");
  if (info.project.name === "mobile-chromium")
    await stableShot(page, "flow-growth-basic-light", true);

  // 키보드로도 고른다
  await chart.getByRole("button", { name: /2021년 7월 20일/ }).focus();
  await page.keyboard.press("Enter");
  await expect(detail).toContainText("81 cm");

  // 탭 전환: 머리둘레에는 판독 불확실 점이 있다
  await tabs.getByRole("button", { name: "머리둘레" }).click();
  await expect(tabs.getByRole("button", { name: "머리둘레" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const head = page.getByRole("group", { name: "머리둘레 성장 곡선 그래프" });
  await expect(head.getByRole("button")).toHaveCount(2);
  await expect(head.getByRole("button", { name: /판독 불확실/ })).toHaveCount(1);
  await expect(page.getByText("점을 누르면 값과 측정 조건을 볼 수 있어요.")).toBeVisible(); // 선택 초기화
  await head.getByRole("button", { name: /판독 불확실/ }).click();
  await expect(detail).toContainText("판독 불확실");
  await expect(detail).toContainText("없음"); // 결과지 백분위가 인쇄돼 있지 않다

  // 표 보기: 같은 정보가 표로
  await tabs.getByRole("button", { name: "몸무게" }).click();
  await page.getByRole("button", { name: "표로 보기" }).click();
  await expect(page.getByRole("group", { name: /성장 곡선 그래프/ })).toHaveCount(0);
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(1 + 4); // 머리글 + 몸무게 점 4개
  await expect(table.getByRole("row").filter({ hasText: "2021년 1월 20일" })).toContainText(
    "집에서 측정",
  );
  await expect(table.getByRole("row").filter({ hasText: "2020년 5월 20일" })).toContainText("40");
  await expect(table.getByRole("columnheader", { name: "기준 50%" })).toBeVisible();
  if (info.project.name === "mobile-chromium")
    await stableShot(page, "flow-growth-table-basic-light");
  await page.getByRole("button", { name: "그래프로 보기" }).click();
  await expect(page.getByRole("group", { name: "몸무게 성장 곡선 그래프" })).toBeVisible();

  // BMI 탭도 그려진다
  await tabs.getByRole("button", { name: "BMI" }).click();
  await expect(page.getByRole("group", { name: "BMI 성장 곡선 그래프" })).toBeVisible();
  await settle(page);
});

test("성장 곡선: 360px 에서 가로로 넘치지 않는다", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("link", { name: /성장 곡선/ }).click();
  await expect(page.getByRole("group", { name: "키 성장 곡선 그래프" })).toBeVisible();
  const over = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(over).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "표로 보기" }).click();
  const over2 = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(over2).toBeLessThanOrEqual(0); // 표는 자기 안에서 가로 스크롤
});

test("문서: 열이 셋 이상인 표는 줄 카드로, 목록·접는 칸·체크박스·맨 위로", async ({
  page,
}, info) => {
  await openLibrary(page);
  await page.getByRole("link", { name: /합성 생활 가이드/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "합성 생활 가이드" })).toBeVisible();

  // 맨 위로 단추는 처음엔 보이지 않는다
  await expect(page.getByRole("button", { name: /맨 위로/ })).toHaveCount(0);

  // 3열 표(항목·기록 방법·예시)는 가로 스크롤 없이 읽히는 줄 카드, 2열 표는 그대로 표
  const rows = page.locator(".md-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("식사");
  await expect(rows.first()).toContainText("기록 방법");
  await expect(rows.first()).toContainText("먹은 양을 칩으로 고른다");
  await expect(page.getByRole("table")).toHaveCount(1);
  expect(
    await page.evaluate(
      "document.documentElement.scrollWidth <= document.documentElement.clientWidth",
    ),
  ).toBe(true);

  // 체크박스는 소리로도 상태가 전해지고, 중첩 목록·취소선·접는 칸이 그려진다
  await expect(page.getByText("완료:")).toBeAttached();
  await expect(page.getByText("아직:")).toBeAttached();
  await expect(page.locator(".doc-body li li")).toHaveCount(2);
  await expect(page.locator(".doc-body del")).toHaveText("지난 방식");
  const details = page.locator("details.md-details");
  await expect(details.locator("summary")).toHaveText("자세히 보기");
  await expect(details.getByText("접어 둔 설명이다.")).toBeHidden();
  await details.locator("summary").click();
  await expect(details.getByText("접어 둔 설명이다.")).toBeVisible();
  await expect(details.locator("strong code")).toHaveText("코드");

  // 맨 위로: 내려가면 나타나며, 누르면 맨 위로 간다
  await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  const top = page.getByRole("button", { name: /맨 위로/ });
  await expect(top).toBeVisible();
  await top.click();
  await expect.poll(() => page.evaluate("window.scrollY")).toBe(0);
  await expect(page.getByRole("heading", { level: 1, name: "합성 생활 가이드" })).toBeFocused();
  if (info.project.name === "mobile-chromium") await settle(page);
});
