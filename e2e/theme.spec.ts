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
