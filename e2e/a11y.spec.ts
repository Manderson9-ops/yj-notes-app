import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Q-A11Y: no serious/critical axe violations. Also writes 360px screenshots (synthetic UI only,
// FAKE mock API, no real data) to e2e/__screenshots__/.

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
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test("PIN screen, home and settings have no serious a11y violations", async ({
      page,
    }, info) => {
      const shot = async (name: string) => {
        if (info.project.name !== "mobile-chromium") return;
        await page.screenshot({ path: `e2e/__screenshots__/${name}-${scheme}.png` });
      };

      await page.goto("/");
      await expect(page.getByRole("button", { name: "확인" })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await shot("pin");

      await login(page);
      expect(await seriousViolations(page)).toEqual([]);
      await shot("home");

      await page.getByRole("link", { name: "설정" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await shot("settings");

      // wrong-PIN state on the PIN screen (message colour)
      await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
      for (const d of "9999") await page.getByRole("button", { name: d, exact: true }).click();
      await page.getByRole("button", { name: "확인" }).click();
      await expect(page.getByText("PIN 이 맞지 않아요.")).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}
