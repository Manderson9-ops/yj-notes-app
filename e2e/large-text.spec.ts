import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// TH-3 / TH-4: 3 themes × (normal | large text) — axe 0, touch targets >= 48px, no text overflow
// in round keys, small text scales. Screenshots (mobile-chromium only): e2e/__screenshots__/<screen>-<theme>-large-<scheme>.png

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
type Scheme = "light" | "dark";
const COMBOS: { theme: (typeof THEMES)[number]; large: boolean; scheme: Scheme }[] = [
  ...THEMES.flatMap((theme) => [
    { theme, large: false, scheme: "light" as const },
    { theme, large: true, scheme: "light" as const },
  ]),
  { theme: "forest", large: true, scheme: "dark" },
  { theme: "crayon", large: true, scheme: "dark" },
];

for (const { theme, large, scheme } of COMBOS) {
  test.describe(`${theme} ${large ? "large" : "normal"} text ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("PIN, settings and preview: axe 0, touch targets, text scale, no overflow", async ({
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
        await stableShot(page, `${name}-${theme}-large-${scheme}`, fullPage);
      };
      const check = async () => {
        await settle(page);
        expect(await seriousViolations(page)).toEqual([]);
        await expectTargets(page);
      };
      // 14px 고정 글자(탭 라벨·배지·메타)도 큰 글씨에서 커진다: max(14px, 0.82 × 본문)
      const smallText = large ? /^16\.4/ : /^14(\.\d+)?px$/;

      await page.goto("/");
      await expect(page.getByRole("button", { name: "모두 지우기" })).toBeVisible();
      await check();
      await expectNoKeyOverflow(page);
      await shot("pin");

      for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
      await expect(page.locator(".tab span").first()).toHaveCSS("font-size", smallText);
      if (large) {
        const px = await page.evaluate(
          "parseFloat(getComputedStyle(document.querySelector('.tab span')).fontSize)",
        );
        expect(px).toBeGreaterThan(14);
      }

      await page.getByRole("link", { name: "설정", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
      await check();
      await shot("settings");

      await page.getByRole("link", { name: "디자인 미리보기" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "디자인 미리보기" })).toBeVisible();
      await expect(page.locator(".badge").first()).toHaveCSS("font-size", smallText);
      await check();
      await shot("preview", true);
    });
  });
}
