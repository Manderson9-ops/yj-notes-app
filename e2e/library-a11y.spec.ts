import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// T-C2 Q-A11Y: 자료실·문서·검진·성장(차트·표) — 3 테마 × 라이트/다크, 큰 글씨. axe serious/critical 0.
// 스크린샷(mobile-chromium 만): e2e/__screenshots__/<screen>-<theme>-<scheme>.png (합성 FAKE 자료)

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

/** 화면에 보이는 터치 대상이 48px 이상인가(링크·버튼·칩·차트 점의 터치 영역). */
async function expectTargets(page: Page) {
  for (const sel of [".chip", ".btn", ".toc-btn", "a.doc-card", ".tab"]) {
    for (const loc of await page.locator(sel).all()) {
      const box = await loc.boundingBox();
      if (!box) continue;
      expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(47.5);
    }
  }
}

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(over).toBeLessThanOrEqual(0);
}

const COMBOS = [
  ...THEMES.flatMap((theme) => [
    { theme, scheme: "light" as const, large: false },
    { theme, scheme: "dark" as const, large: false },
  ]),
  ...THEMES.map((theme) => ({ theme, scheme: "light" as const, large: true })),
  { theme: "basic" as const, scheme: "dark" as const, large: true },
];

for (const { theme, scheme, large } of COMBOS) {
  test.describe(`자료 화면 ${theme} ${scheme}${large ? " 큰 글씨" : ""}`, () => {
    test.use({ colorScheme: scheme });
    // 화면 5곳 × axe 스캔이라 병렬 부하에서 기본 30초를 넘길 수 있다
    test.setTimeout(90_000);

    test("목록·문서·검진·성장: axe 0, 터치 48px, 가로 넘침 없음", async ({ page }, info) => {
      await page.addInitScript(
        ([t, l]) => {
          localStorage.setItem("yj.theme", t ?? "basic");
          if (l === "1") localStorage.setItem("yj.largeText", "1");
        },
        [theme, large ? "1" : "0"],
      );
      const shot = async (name: string, fullPage = false) => {
        if (info.project.name !== "mobile-chromium") return;
        await stableShot(page, `${name}-${theme}${large ? "-large" : ""}-${scheme}`, fullPage);
      };
      const check = async () => {
        await settle(page);
        expect(await seriousViolations(page)).toEqual([]);
        await expectTargets(page);
        await noHorizontalOverflow(page);
      };

      await login(page);
      await page.getByRole("link", { name: "자료", exact: true }).click();
      await expect(page.getByRole("link", { name: /합성 생활 가이드/ })).toBeVisible();
      await check();
      if (!large) await shot("library", true);

      await page.getByRole("link", { name: /합성 생활 가이드/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "합성 생활 가이드" })).toBeVisible();
      await page.getByText(/^목차/).click();
      await check();

      await page.getByRole("link", { name: "← 자료" }).click();
      await page.getByRole("link", { name: /합성 발달 보고서/ }).click();
      await expect(page.locator("iframe")).toBeVisible();
      await check();

      await page.goto("/library/checkups");
      await expect(page.getByRole("heading", { level: 1, name: "검진" })).toBeVisible();
      await check();

      await page.getByRole("link", { name: "성장 곡선 보기" }).click();
      const chart = page.getByRole("group", { name: "키 성장 곡선 그래프" });
      await expect(chart).toBeVisible();
      await chart.getByRole("button", { name: /2020년 9월 12일/ }).click();
      await check();
      if (!large) await shot("growth", true);

      await page.getByRole("button", { name: "머리둘레" }).click();
      await page
        .getByRole("group", { name: "머리둘레 성장 곡선 그래프" })
        .getByRole("button", { name: /판독 불확실/ })
        .click();
      await check();

      await page.getByRole("button", { name: "표로 보기" }).click();
      await expect(page.getByRole("table")).toBeVisible();
      await check();
    });
  });
}
