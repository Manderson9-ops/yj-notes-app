import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// TH-3 / TH-4: 3 themes × (normal | large text) — axe 0, touch targets >= 48px, no text overflow
// in round keys. Screenshots (mobile-chromium only): e2e/__screenshots__/<screen>-<theme>-large-light.png

const THEMES = ["basic", "crayon", "forest"] as const;
const TARGETS = [".key", ".chip", ".btn", ".btn-primary", ".tab", ".theme-option"] as const;

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`);
}

async function settle(page: Page) {
  // 문자열로 실행: e2e 의 tsconfig 에는 DOM 타입이 없다.
  await page.evaluate(
    "Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished))",
  );
}

/** 화면에 보이는 터치 대상의 높이·너비가 모두 48px 이상인지(TH-4). */
async function expectTargets(page: Page) {
  for (const sel of TARGETS) {
    for (const loc of await page.locator(sel).all()) {
      const box = await loc.boundingBox();
      if (!box) continue;
      expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(47.5);
      expect(box.width, `${sel} width`).toBeGreaterThanOrEqual(47.5);
    }
  }
}

/** 키 안의 글자가 넘치지 않는지. */
async function expectNoKeyOverflow(page: Page) {
  const bad = await page.evaluate(
    "Array.from(document.querySelectorAll('.key')).filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length",
  );
  expect(bad, "overflowing keys").toBe(0);
}
for (const theme of THEMES) {
  for (const large of [false, true]) {
    const label = large ? "large text" : "normal text";
    test.describe(`${theme} ${label}`, () => {
      test.use({ colorScheme: "light" });

      test("PIN, settings and preview: axe 0, touch targets, no overflow", async ({
        page,
      }, info) => {
        await page.addInitScript(
          ([t, l]) => {
            localStorage.setItem("yj.theme", t ?? "basic");
            if (l === "1") localStorage.setItem("yj.largeText", "1");
          },
          [theme, large ? "1" : "0"],
        );
        const shot = async (name: string, fullPage = false) => {
          if (!large || info.project.name !== "mobile-chromium") return;
          await settle(page);
          await page.screenshot({
            path: `e2e/__screenshots__/${name}-${theme}-large-light.png`,
            fullPage,
          });
        };
        const check = async () => {
          await settle(page);
          expect(await seriousViolations(page)).toEqual([]);
          await expectTargets(page);
        };

        await page.goto("/");
        await expect(page.getByRole("button", { name: "확인" })).toBeVisible();
        await check();
        await expectNoKeyOverflow(page);
        await shot("pin");

        for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
        await page.getByRole("button", { name: "확인" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();

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
      });
    });
  }
}
