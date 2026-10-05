import { expect, test } from "@playwright/test";
import { stableElementShot } from "./helpers";

// 요소 단위 시각 회귀(로컬 win32 에서만 비교, threshold 0.02): 테마별 작은 요소 — h2 띠, 선택 칩, 주 버튼.
// 파일: e2e/__screenshots__/el-<요소>-<테마>-<scheme>.png

for (const theme of ["crayon", "forest"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`elements ${theme} ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test("h2, selected chip and primary button", async ({ page }, info) => {
        test.skip(info.project.name !== "mobile-chromium", "렌더 비교는 chromium 만");
        await page.addInitScript((t) => {
          localStorage.setItem("yj.theme", t);
        }, theme);
        await page.goto("/");
        for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
        await page.goto("/settings/design");
        await expect(
          page.getByRole("heading", { level: 1, name: "디자인 미리보기" }),
        ).toBeVisible();

        await stableElementShot(page, page.locator("#pv-log"), `el-h2-${theme}-${scheme}`);
        await stableElementShot(
          page,
          page.locator('.chip[aria-pressed="true"]').first(),
          `el-chip-${theme}-${scheme}`,
        );
        await stableElementShot(
          page,
          page.locator(".btn-primary").first(),
          `el-primary-${theme}-${scheme}`,
        );
      });
    });
  }
}

// 스위치 줄(켜짐/꺼짐) 요소 스냅샷: 3테마 × 라이트/다크 × (일반, 선명하게 보기). 켜짐 모양이 깨지면(회귀) 바로 잡는다.
// 일반 모드: 꺼짐 = 「선명하게 보기」, 켜짐 = 「큰 글씨」를 켠 뒤. 선명하게 보기 모드: 켜짐 = 「선명하게 보기」, 꺼짐 = 「큰 글씨」.
for (const theme of ["basic", "crayon", "forest"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    for (const mode of ["normal", "high"] as const) {
      test(`switch rows ${theme} ${scheme} ${mode}`, async ({ page }, info) => {
        test.skip(info.project.name !== "mobile-chromium", "렌더 비교는 chromium 만");
        await page.addInitScript(
          ({ t, s, m }) => {
            localStorage.setItem("yj.theme", t);
            localStorage.setItem("yj.scheme", s);
            if (m === "high") localStorage.setItem("yj.contrast", "high");
          },
          { t: theme, s: scheme, m: mode },
        );
        await page.goto("/");
        for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
        await page.goto("/settings");
        await expect(page.getByRole("switch", { name: "큰 글씨" })).toBeVisible();
        await page.emulateMedia({ reducedMotion: "reduce" });
        const row = (name: string) => page.locator(".switch-row", { hasText: name });
        const suffix = `${theme}-${scheme}${mode === "high" ? "-high" : ""}`;
        if (mode === "normal") {
          await stableElementShot(page, row("선명하게 보기"), `el-switch-off-${suffix}`);
          await page.getByRole("switch", { name: "큰 글씨" }).check();
          await stableElementShot(page, row("큰 글씨"), `el-switch-on-${suffix}`);
        } else {
          await stableElementShot(page, row("큰 글씨"), `el-switch-off-${suffix}`);
          await stableElementShot(page, row("선명하게 보기"), `el-switch-on-${suffix}`);
        }
      });
    }
  }
}
