import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Q-A11Y / TH-3: no serious/critical axe violations in 3 themes × light/dark.
// Also writes 360px screenshots (synthetic UI only, FAKE mock API, no real data) to
// e2e/__screenshots__/<screen>-<theme>-<scheme>.png (mobile-chromium project only).

const THEMES = ["basic", "crayon", "forest"] as const;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`);
}

/** 끝나는 전환·등장 모션이 지난 뒤 검사한다(반투명 중간 색으로 대비를 잘못 재지 않도록). */
async function settle(page: Page) {
  // 문자열로 실행: e2e 의 tsconfig 에는 DOM 타입이 없다.
  await page.evaluate(
    "Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished))",
  );
}

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

for (const theme of THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${theme} ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test("PIN, home, settings and preview have no serious a11y violations", async ({
        page,
      }, info) => {
        await page.addInitScript((t) => {
          localStorage.setItem("yj.theme", t);
        }, theme);
        const shot = async (name: string, fullPage = false) => {
          if (info.project.name !== "mobile-chromium") return;
          await settle(page);
          await page.screenshot({
            path: `e2e/__screenshots__/${name}-${theme}-${scheme}.png`,
            fullPage,
          });
        };
        const check = async () => {
          await settle(page);
          expect(await seriousViolations(page)).toEqual([]);
        };

        await page.goto("/");
        await expect(page.getByRole("button", { name: "확인" })).toBeVisible();
        await check();
        await shot("pin");

        await login(page);
        await check();
        await shot("home");

        await page.getByRole("link", { name: "설정", exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
        await check();
        await shot("settings");

        await page.getByRole("link", { name: "디자인 미리보기" }).click();
        await expect(
          page.getByRole("heading", { level: 1, name: "디자인 미리보기" }),
        ).toBeVisible();
        await check();
        await shot("preview", true);

        // wrong-PIN state on the PIN screen (message colour)
        await page.getByRole("link", { name: "설정", exact: true }).click();
        await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
        for (const d of "9999") await page.getByRole("button", { name: d, exact: true }).click();
        await page.getByRole("button", { name: "확인" }).click();
        await expect(page.getByText("PIN 이 맞지 않아요.")).toBeVisible();
        await check();
      });
    });
  }
}
