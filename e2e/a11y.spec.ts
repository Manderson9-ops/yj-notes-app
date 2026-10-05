import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// Q-A11Y / TH-3: no serious/critical axe violations in 3 themes × light/dark.
// Also writes 360px screenshots (synthetic UI only, FAKE mock API, no real data) to
// e2e/__screenshots__/<screen>-<theme>-<scheme>.png (mobile-chromium project only).

const THEMES = ["basic", "crayon", "forest"] as const;

async function seriousViolations(page: Page) {
  // 화면이 길어서 따라오는(sticky) 탭바가 스크롤 맨 위 화면의 아래쪽 요소를 가린다(axe 는 스크롤하지 않음). 검사하는 동안만 흐름 안에 둔다.
  await page.evaluate("document.querySelector('.tabbar')?.classList.add('is-static-for-shot')");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await page.evaluate("document.querySelector('.tabbar')?.classList.remove('is-static-for-shot')");
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)})`);
}

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

for (const theme of THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${theme} ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test("PIN, home, settings and preview have no serious a11y violations", async ({
        page,
      }, info) => {
        test.slow(); // 알림장 화면까지 돌아서 webkit 에서 30초를 넘길 수 있다
        // 밝기는 시스템 에뮬레이션이 아니라 설정값(yj.scheme)으로 정한다(T-D1)
        await page.addInitScript(
          ({ t, s }) => {
            localStorage.setItem("yj.theme", t);
            localStorage.setItem("yj.scheme", s);
          },
          { t: theme, s: scheme },
        );
        const shot = async (name: string, fullPage = false) => {
          if (info.project.name !== "mobile-chromium") return;
          await stableShot(page, `${name}-${theme}-${scheme}`, fullPage);
        };
        const check = async () => {
          await settle(page);
          expect(await seriousViolations(page)).toEqual([]);
        };

        await page.goto("/");
        await expect(page.getByRole("button", { name: "모두 지우기" })).toBeVisible();
        await check();
        await shot("pin");

        await login(page);
        await check();
        await shot("home");

        // S30 알림장 목록·검색, S31 상세 (합성 mock 자료)
        await page.getByRole("link", { name: "알림장", exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: "알림장" })).toBeVisible();
        await expect(page.locator(".note-row").first()).toBeVisible();
        await check();
        await shot("notes");
        await page.getByRole("searchbox", { name: "알림장 검색" }).fill("그림책");
        await expect(page.locator(".note-row mark").first()).toBeVisible();
        await check();
        await shot("notes-search");
        await page.goto("/notes/2020-03-05?q=낮잠");
        await expect(page.locator(".note-report mark").first()).toBeVisible();
        await check();
        await shot("note-detail", true);

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
        await expect(page.locator("html")).toHaveAttribute("data-scheme", scheme);

        // wrong-PIN state on the PIN screen (message colour)
        await page.getByRole("link", { name: "설정", exact: true }).click();
        await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
        for (const d of "9999") await page.getByRole("button", { name: d, exact: true }).click();
        await expect(page.getByText("PIN 이 맞지 않아요.")).toBeVisible();
        await check();
      });
    });
  }
}

// T-D1: 선명하게 보기(yj.contrast=high) — 6조합 미리보기 화면 캡처 + axe 0
for (const theme of THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    test(`선명하게 보기 ${theme} ${scheme}: 미리보기 axe 0 + 캡처`, async ({ page }, info) => {
      test.slow();
      await page.addInitScript(
        ({ t, s }) => {
          localStorage.setItem("yj.theme", t);
          localStorage.setItem("yj.scheme", s);
          localStorage.setItem("yj.contrast", "high");
        },
        { t: theme, s: scheme },
      );
      await login(page);
      await page.getByRole("link", { name: "설정", exact: true }).click();
      await page.getByRole("link", { name: "디자인 미리보기" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "디자인 미리보기" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
      if (info.project.name === "mobile-chromium") {
        await stableShot(page, `preview-${theme}-${scheme}-high`, true);
      }
    });
  }
}
