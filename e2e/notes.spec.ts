import { expect, test, type Page } from "@playwright/test";

// 흐름 4(docs/08 §2): 알림장 찾기 = 검색 -> 목록 -> 상세 -> 이전/다음 -> 뒤로. FAKE mock API(합성 62일)만 쓴다.

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

const rows = (page: Page) => page.locator(".note-row");

test("flow 4: search, list, detail, prev/next, back", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "알림장", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "알림장" })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "2020년 5월" })).toBeVisible();

  await page.getByRole("searchbox", { name: "알림장 검색" }).fill("그림책");
  await expect(page).toHaveURL(/\/notes\?q=/); // 디바운스 뒤 주소에 반영
  await expect(page.getByRole("status").filter({ hasText: "「그림책」" })).toBeVisible();
  const marks = rows(page).first().locator("mark");
  await expect(marks.first()).toHaveText("그림책");

  const listCount = await rows(page).count();
  await rows(page).first().click();
  await expect(page).toHaveURL(/\/notes\/2020-\d\d-\d\d\?q=/);
  const detailUrl = page.url();
  await expect(page.locator(".note-report mark").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "곳" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "이전·다음 날 (아래)" })
    .getByRole("link", { name: /이전 날/ })
    .click();
  await expect(page).not.toHaveURL(detailUrl);
  await page
    .getByRole("navigation", { name: "이전·다음 날 (아래)" })
    .getByRole("link", { name: /다음 날/ })
    .click();
  await expect(page).toHaveURL(detailUrl);

  // 이전/다음은 history 를 쌓지 않으므로 뒤로 한 번에 같은 검색 목록
  await page.getByRole("button", { name: "알림장 목록" }).click();
  await expect(page).toHaveURL(/\/notes\?q=/);
  await expect(page.getByRole("searchbox", { name: "알림장 검색" })).toHaveValue("그림책");
  await expect(rows(page)).toHaveCount(listCount);
});

test("list: month headers, load more, scroll position restored after back", async ({ page }) => {
  await login(page);
  await page.goto("/notes");
  await expect(rows(page)).toHaveCount(20);
  await page.getByRole("button", { name: "더 보기" }).click();
  await expect(rows(page)).toHaveCount(40);
  await expect(page.getByRole("heading", { level: 2, name: "2020년 4월" })).toBeVisible();
  const target = rows(page).nth(35);
  await target.scrollIntoViewIfNeeded();
  const before = await page.evaluate("window.scrollY");
  expect(Number(before)).toBeGreaterThan(500);
  await target.click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("알림장");
  await page.getByRole("button", { name: "알림장 목록" }).click();
  await expect(rows(page)).toHaveCount(40);
  await expect
    .poll(async () => Math.abs(Number(await page.evaluate("window.scrollY")) - Number(before)))
    .toBeLessThan(40);
});

test("search box: 40 char limit, clear button, period chip, empty states", async ({ page }) => {
  await login(page);
  await page.goto("/notes");
  const box = page.getByRole("searchbox", { name: "알림장 검색" });
  await box.fill("가".repeat(50));
  await expect(box).toHaveValue("가".repeat(40));
  await page.getByRole("button", { name: "검색어 지우기" }).click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();

  await page.getByRole("button", { name: "최근 1달" }).click();
  await expect(page.getByRole("button", { name: "최근 1달" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => rows(page).count()).toBeGreaterThan(5);
  await expect(rows(page).first()).toContainText("5월");

  await box.fill("없는낱말");
  await expect(page.getByText("「없는낱말」가 들어간 알림장이 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "기간을 전체로 바꿔 보세요" }).click();
  await expect(page.getByRole("button", { name: "전체", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("다른 낱말로 찾아 보세요.")).toBeVisible();
});

test("list: server error shows reason and retry", async ({ page }) => {
  await login(page);
  await page.goto("/notes?q=오류시험");
  await expect(page.getByRole("alert")).toContainText("자료를 불러오지 못했어요.");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeVisible();
});

test("detail: roles are labelled, two reports, empty body, bad date", async ({ page }) => {
  await login(page);
  await page.goto("/notes/2020-03-05");
  await expect(page.getByRole("heading", { level: 1, name: "2020년 3월 5일 (목)" })).toBeVisible();
  await expect(page.locator(".note-comment[data-who='parent'] .note-who")).toHaveText("보호자");
  await expect(page.locator(".note-comment[data-who='teacher'] .note-who")).toHaveText("교사");

  await page.goto("/notes/2020-03-11");
  await expect(page.getByRole("heading", { level: 2, name: "집에서 보낸 글" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "알림장" })).toBeVisible();

  await page.goto("/notes/2020-03-22");
  await expect(page.getByText("본문이 비어 있어요.")).toBeVisible();

  await page.goto("/notes/2019-01-01");
  await expect(page.getByRole("alert")).toContainText("찾는 자료가 없어요.");
  await page.getByRole("link", { name: "알림장 목록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "알림장" })).toBeVisible();
});

test("detail: first and last day disable the missing neighbour", async ({ page }) => {
  await login(page);
  await page.goto("/notes/2020-03-02");
  await expect(
    page
      .getByRole("navigation", { name: "이전·다음 날 (아래)" })
      .getByRole("button", { name: /이전 날/ }),
  ).toBeDisabled();
});

test("home: record button, recent notes, facts from the API, stale sync warning", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole("link", { name: "오늘 기록하기" })).toHaveAttribute(
    "href",
    "/logs/new",
  );
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText("62일")).toBeVisible(); // 합성 자료 일수 = API 값
  await expect(page.getByText(/마지막 동기화가 \d+일 전이에요/)).toHaveCount(0);
  await rows(page).first().click();
  await expect(page).toHaveURL(/\/notes\/2020-05-02/);
});

test("home: 14+ days since sync shows the warning; empty data is not an error", async ({
  page,
}) => {
  await page.route("**/api/overview", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { lastIngest: { at: string } };
    body.lastIngest.at = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await route.fulfill({ response: res, json: body });
  });
  await login(page);
  await expect(page.getByText("마지막 동기화가 20일 전이에요.")).toBeVisible();

  await page.unroute("**/api/overview");
  await page.route("**/api/overview", (route) =>
    route.fulfill({
      json: {
        noteDays: 0,
        reports: 0,
        comments: 0,
        range: null,
        lastIngest: null,
        milestones: { observed: 0, unobserved: 0 },
        recentNotes: [],
        recentLogs: [],
      },
    }),
  );
  await page.reload();
  await expect(page.getByText("아직 알림장이 없어요.")).toBeVisible();
  await expect(page.getByText("아직 없어요")).toBeVisible();
});
