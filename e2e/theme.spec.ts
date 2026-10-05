import { expect, test, type Page } from "@playwright/test";

// Runs against `npm run dev:mock` (FAKE session API; PIN "0000").

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

function trackFonts(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/fonts/")) urls.push(new URL(r.url()).pathname);
  });
  return urls;
}

test("theme switch applies at once and survives a reload", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await page.getByRole("radio", { name: "크레용" }).check();
  await expect(html).toHaveAttribute("data-theme", "crayon");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "crayon");
  await expect(page.getByRole("radio", { name: "크레용" })).toBeChecked();
  await page.getByRole("radio", { name: "숲" }).check();
  await expect(html).toHaveAttribute("data-theme", "forest");
  await page.getByRole("radio", { name: "기본" }).check();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  expect(await page.evaluate(() => localStorage.getItem("yj.theme"))).toBe("basic");
});

test("an invalid saved theme falls back to basic", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yj.theme", "neon");
  });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("basic theme requests no font files", async ({ page }) => {
  const fonts = trackFonts(page);
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("link", { name: "디자인 미리보기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "디자인 미리보기" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(fonts).toEqual([]);
});

test("crayon theme requests exactly one font file (Jua subset)", async ({ page }) => {
  const fonts = trackFonts(page);
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("radio", { name: "크레용" }).check();
  await expect.poll(() => fonts.length).toBe(1);
  expect(fonts[0]).toBe("/fonts/yj-crayon-display.woff2");
  await page.getByRole("link", { name: "디자인 미리보기" }).click();
  await page.waitForLoadState("networkidle");
  expect(fonts).toHaveLength(1);
});

test("forest theme requests exactly one font file (Gowun Batang subset)", async ({ page }) => {
  const fonts = trackFonts(page);
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("radio", { name: "숲" }).check();
  await expect.poll(() => fonts.length).toBe(1);
  expect(fonts[0]).toBe("/fonts/yj-forest-display.woff2");
  await page.getByRole("link", { name: "디자인 미리보기" }).click();
  await page.waitForLoadState("networkidle");
  expect(fonts).toHaveLength(1);
});
test("prefers-reduced-motion switches decor animation off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("yj.theme", "forest");
  });
  await login(page);
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "기록" })
    .click();
  const leaf = page.locator(".decor-sway");
  await expect(leaf).toHaveCount(1);
  await expect(leaf).toHaveCSS("animation-name", "none");
  await expect(page.locator(".shell-main > *").first()).toHaveCSS("animation-name", "none");
});

test("decor sways only when motion is allowed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("yj.theme", "forest");
  });
  await login(page);
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "기록" })
    .click();
  await expect(page.locator(".decor-sway")).toHaveCSS("animation-name", "forest-sway");
});

async function crayonPreview(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("yj.theme", "crayon");
  });
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("link", { name: "디자인 미리보기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "디자인 미리보기" })).toBeVisible();
}

test("reduced-motion: crayon tab underline, button pop and press move are off", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("yj.theme", "crayon");
  });
  await login(page);
  // 활성 탭 밑줄(홈 탭)
  const underline = page.locator(".tab.active .decor-tab path.d-line");
  await expect(underline).toHaveCount(1);
  await expect(underline).toHaveCSS("animation-name", "none");
  // 포인터로 눌렀다 뗀 버튼의 pop
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("link", { name: "디자인 미리보기" }).click();
  const btn = page.getByRole("button", { name: "보조 버튼" });
  await btn.click();
  await expect(btn).toHaveCSS("animation-name", "none");
  // 누르는 동안 이동도 없다
  await btn.hover();
  await page.mouse.down();
  await expect(btn).toHaveCSS("transform", "none");
  await page.mouse.up();
});

test("crayon: button pop plays after a pointer press, not after keyboard focus", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "Safari 는 클릭해도 버튼에 포커스가 남지 않는다");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await crayonPreview(page);
  const btn = page.getByRole("button", { name: "보조 버튼" });
  await btn.click();
  await expect(btn).toHaveCSS("animation-name", "crayon-pop");
  // 키보드 포커스(Tab)로는 튀지 않는다
  await page.getByRole("button", { name: "주 버튼" }).focus();
  await page.keyboard.press("Tab");
  await expect(btn).toBeFocused();
  await expect(btn).toHaveCSS("animation-name", "none");
});
test("decor SVGs are hidden from assistive tech and ignore pointers", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yj.theme", "crayon");
  });
  await login(page);
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "기록" })
    .click();
  const svgs = page.locator(".empty svg");
  await expect(svgs.first()).toBeVisible();
  for (const svg of await svgs.all()) {
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(svg).toHaveCSS("pointer-events", "none");
  }
});

test("scheme choice applies at once, survives a reload, and system follows the OS", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-scheme", "light");
  await expect(page.getByRole("radio", { name: "시스템에 맞춤" })).toBeChecked();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-scheme", "dark");
  await page.getByRole("radio", { name: "밝게" }).check();
  await expect(html).toHaveAttribute("data-scheme", "light");
  await page.reload();
  await expect(html).toHaveAttribute("data-scheme", "light");
  await expect(page.getByRole("radio", { name: "밝게" })).toBeChecked();
  await page.getByRole("radio", { name: "어둡게" }).check();
  await expect(html).toHaveAttribute("data-scheme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("yj.scheme"))).toBe("dark");
});

test("high contrast switch applies at once and survives a reload", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-contrast", /.+/);
  await page.getByRole("switch", { name: "선명하게 보기" }).check();
  await expect(html).toHaveAttribute("data-contrast", "high");
  await page.reload();
  await expect(html).toHaveAttribute("data-contrast", "high");
  await expect(page.getByRole("switch", { name: "선명하게 보기" })).toBeChecked();
  await page.getByRole("switch", { name: "선명하게 보기" }).uncheck();
  await expect(html).not.toHaveAttribute("data-contrast", /.+/);
});

test("header settings button shows icon and the visible label 설정, at least 48px tall", async ({
  page,
}) => {
  await login(page);
  const btn = page.locator(".shell-header").getByRole("link", { name: "설정" });
  await expect(btn).toContainText("설정");
  const box = await btn.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
});

for (const theme of ["basic", "crayon", "forest"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`눌리는 카드는 안 눌리는 카드보다 테두리가 굵다: ${theme} ${scheme}`, async ({ page }) => {
      await page.addInitScript(
        ({ t, s }) => {
          localStorage.setItem("yj.theme", t);
          localStorage.setItem("yj.scheme", s);
        },
        { t: theme, s: scheme },
      );
      await login(page);
      await page.getByRole("link", { name: "설정", exact: true }).click();
      await page.getByRole("link", { name: "디자인 미리보기" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "디자인 미리보기" })).toBeVisible();
      const w = async (sel: string) =>
        Number(
          await page.evaluate(
            `parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).borderTopWidth)`,
          ),
        );
      const tappable = await w("a.card");
      const fixed = await w("article.card");
      expect(tappable).toBeGreaterThan(fixed);
      if (scheme === "dark") {
        // 다크: 눌리는 카드는 한 단계 밝은 면(크레용은 첫 그라데이션 층이 면 색)
        const fill = async (sel: string) =>
          String(
            await page.evaluate(
              `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(sel)})); const m = s.backgroundImage.match(/rgb\\([^)]*\\)/); return m ? m[0] : s.backgroundColor; })()`,
            ),
          );
        expect(await fill("a.card")).not.toBe(await fill("article.card"));
      }
    });
  }
}

// SettingSwitch: 켜짐이면 트랙이 강조색이고 손잡이가 오른쪽, 꺼짐이면 그 반대(트랙 안쪽 구조가 바뀌어도 규칙이 이어지는지)
for (const mode of ["normal", "high"] as const) {
  for (const theme of ["basic", "crayon", "forest"] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`스위치 켜짐/꺼짐 모양: ${theme} ${scheme} ${mode}`, async ({ page }) => {
        await page.addInitScript(
          ({ t, s, m }) => {
            localStorage.setItem("yj.theme", t);
            localStorage.setItem("yj.scheme", s);
            if (m === "high") localStorage.setItem("yj.contrast", "high");
          },
          { t: theme, s: scheme, m: mode },
        );
        await page.emulateMedia({ reducedMotion: "reduce" }); // 손잡이 이동 전환을 끄고 최종 위치를 잰다
        await login(page);
        await page.getByRole("link", { name: "설정", exact: true }).click();
        await expect(page.getByRole("switch", { name: "큰 글씨" })).toBeVisible();
        const probe = (name: string) =>
          page.evaluate<{ accent: string; bg: string; knobRight: boolean }>(
            `(() => { const hex = getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim(); const n = parseInt(hex.slice(1), 16); const accent = "rgb(" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ") + ")"; const row = [...document.querySelectorAll(".switch-row")].find((r) => r.textContent.includes(${JSON.stringify(name)})); const track = row.querySelector(".switch-track"); const knob = track.querySelector("i"); const a = track.getBoundingClientRect(); const b = knob.getBoundingClientRect(); return { accent, bg: getComputedStyle(track).backgroundColor, knobRight: b.left + b.width / 2 > a.left + a.width / 2 }; })()`,
          );
        const large = page.getByRole("switch", { name: "큰 글씨" });
        const sharp = page.getByRole("switch", { name: "선명하게 보기" });
        // 큰 글씨: 꺼짐 상태
        let p = await probe("큰 글씨");
        expect(p.bg).not.toBe(p.accent);
        expect(p.knobRight).toBe(false);
        if (mode === "high") {
          p = await probe("선명하게 보기");
          expect(p.bg).toBe(p.accent);
          expect(p.knobRight).toBe(true);
          await sharp.uncheck();
          p = await probe("선명하게 보기");
          expect(p.bg).not.toBe(p.accent);
          expect(p.knobRight).toBe(false);
        } else {
          await large.check();
          p = await probe("큰 글씨");
          expect(p.bg).toBe(p.accent);
          expect(p.knobRight).toBe(true);
          await large.uncheck();
          p = await probe("큰 글씨");
          expect(p.bg).not.toBe(p.accent);
          expect(p.knobRight).toBe(false);
        }
      });
    }
  }
}
