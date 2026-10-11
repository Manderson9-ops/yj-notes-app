import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableElementShot } from "./helpers";

// T-S1: 홈의 자동 업데이트 경고(실패·미실행)와 설정 한 줄. 3 테마 × 라이트/다크 + 선명하게 보기. axe serious/critical 0.
// 상태는 page.route 로 overview 응답의 sync 만 바꾼다(합성 값). 스크린샷은 mobile-chromium 만.

const THEMES = ["basic", "crayon", "forest"] as const;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`);
}

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

async function setSync(page: Page, sync: Record<string, unknown>) {
  await page.route("**/api/overview", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    body.sync = sync;
    await route.fulfill({ response: res, json: body });
  });
}

const base = {
  lastOkAt: "2020-05-02T11:10:00.000Z",
  lastAttemptAt: "2020-05-02T11:00:05.000Z",
  newReports: 3,
  lastNoteDate: "2020-05-02",
};

const COMBOS = [
  ...THEMES.flatMap((theme) => [
    { theme, scheme: "light" as const, high: false },
    { theme, scheme: "dark" as const, high: false },
  ]),
  ...THEMES.map((theme) => ({ theme, scheme: "light" as const, high: true })),
];

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const { theme, scheme, high } of COMBOS) {
  test.describe(`자동 업데이트 ${theme} ${scheme}${high ? " 선명하게" : ""}`, () => {
    test.use({ colorScheme: scheme });
    test.setTimeout(90_000);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([t, h]) => {
          localStorage.setItem("yj.theme", t ?? "basic");
          if (h === "1") localStorage.setItem("yj.contrast", "high");
        },
        [theme, high ? "1" : "0"],
      );
    });

    const name = (what: string) => `sync-${what}-${theme}${high ? "-high" : ""}-${scheme}`;

    test("홈 실패 배너: 사유·반영 날짜·다음 안내, axe 0", async ({ page }, info) => {
      await setSync(page, { ...base, state: "failed", code: "kidsnote_login" });
      await login(page);
      const box = page.getByTestId("sync-notice");
      await expect(box).toBeVisible();
      await expect(box).toContainText("오늘 저녁 알림장 자동 업데이트가 안 됐어요.");
      await expect(box).toContainText("키즈노트 로그인이 풀렸어요.");
      await expect(box).toContainText("마지막으로 반영된 알림장: 5월 2일");
      await expect(box).toContainText("내일 저녁 8시에 다시 해요.");
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
      await noHorizontalOverflow(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, box, name("home-failed"));
      }
    });

    test("홈 미실행 배너: 집 PC 사유, axe 0", async ({ page }, info) => {
      await setSync(page, { ...base, state: "missed", code: "missed" });
      await login(page);
      const box = page.getByTestId("sync-notice");
      await expect(box).toContainText("집 PC가 꺼져 있었던 것 같아요.");
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
      await noHorizontalOverflow(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, box, name("home-missed"));
      }
    });

    test("설정 한 줄: 매일 저녁 8시 · 마지막 성공, axe 0", async ({ page }, info) => {
      await setSync(page, { ...base, state: "failed", code: "media" });
      await login(page);
      await page.getByRole("link", { name: "설정", exact: true }).click();
      const line = page.getByTestId("sync-line");
      await expect(line).toHaveText(
        "알림장 자동 업데이트: 매일 저녁 8시 · 마지막 성공 5월 2일 20:10(새 알림장 3건)",
      );
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
      await noHorizontalOverflow(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, line, name("settings-line"));
      }
    });

    test("정상이면 홈에 경고가 없다", async ({ page }) => {
      await setSync(page, { ...base, state: "ok", code: null });
      await login(page);
      await expect(page.getByText("최근 알림장")).toBeVisible();
      await expect(page.getByTestId("sync-notice")).toHaveCount(0);
    });
  });
}
