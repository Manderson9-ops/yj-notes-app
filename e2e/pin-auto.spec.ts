import { expect, test, type Page } from "@playwright/test";

// Runs against `npm run dev:mock` (FAKE session API, pinLength 4; "0000" ok, "1111" locked, else 401).

const key = (page: Page, d: string) => page.getByRole("button", { name: d, exact: true });
const press = async (page: Page, digits: string) => {
  for (const d of digits) await key(page, d).click();
};

test("auto-submits at the 4th digit and enters home without a confirm key", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pin-dot")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "확인" })).toHaveCount(0);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/session")) posts.push(r.postData() ?? "");
  });
  await press(page, "000");
  expect(posts).toHaveLength(0);
  await key(page, "0").click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
  expect(posts).toHaveLength(1);
});

test("wrong PIN: shake class, cleared dots and message, then retry works", async ({ page }) => {
  await page.goto("/");
  await press(page, "9999");
  const status = page.getByRole("status").filter({ hasText: "PIN 이 맞지 않아요." });
  await expect(status).toBeVisible();
  await expect(page.locator(".pin-dots")).toHaveClass(/is-shaking/);
  await expect(page.locator(".pin-dot.filled")).toHaveCount(0);
  await key(page, "1").click();
  await expect(page.locator(".pin-dots")).not.toHaveClass(/is-shaking/);
  await expect(page.locator(".pin-dot.filled")).toHaveCount(1);
});

test("no shake animation with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await press(page, "9999");
  await expect(page.locator(".pin-dots")).toHaveClass(/is-shaking/);
  await expect(page.locator(".pin-dots")).toHaveCSS("animation-name", "none");
});

test("shake animation runs when motion is allowed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await press(page, "9999");
  await expect(page.locator(".pin-dots")).toHaveCSS("animation-name", "pin-shake");
});

test("extra input while a request is in flight is ignored (exactly one POST)", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/session", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await new Promise((r) => setTimeout(r, 700));
    return route.fulfill({ status: 401, json: { error: "invalid_pin", message: "x" } });
  });
  await page.goto("/");
  await press(page, "9999");
  await expect(page.getByText("확인하는 중이에요.")).toBeVisible();
  await page.keyboard.type("1234");
  await expect(page.getByText("PIN 이 맞지 않아요.")).toBeVisible();
  expect(posts).toBe(1);
  await expect(page.locator(".pin-dot.filled")).toHaveCount(0);
});

test("locked PIN shows the countdown and disables the keypad", async ({ page }) => {
  await page.goto("/");
  await press(page, "1111");
  await expect(page.getByText("잠시 잠겼어요. 2분 뒤에 다시 해 주세요.")).toBeVisible();
  await expect(key(page, "1")).toBeDisabled();
  await expect(page.getByRole("button", { name: "모두 지우기" })).toBeDisabled();
});

test("physical keyboard: digits auto-submit, Backspace edits", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".pin-dot")).toHaveCount(4); // keypad (and key listener) ready
  await page.getByRole("heading", { name: "가족 기록" }).click(); // give the page keyboard focus (webkit)
  await page.keyboard.type("00");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".pin-dot.filled")).toHaveCount(1);
  await page.keyboard.type("000");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
});

test("after a wrong PIN the screen stays in auto-submit mode (no confirm key)", async ({
  page,
}) => {
  await page.goto("/");
  await press(page, "9999");
  await expect(page.getByText("PIN 이 맞지 않아요.")).toBeVisible();
  await expect(page.locator(".pin-dot")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "확인" })).toHaveCount(0);
  await press(page, "0000");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
});

test("logout returns to the auto-submit PIN screen", async ({ page }) => {
  await page.goto("/");
  await press(page, "0000");
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
  await expect(page.locator(".pin-dot")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "확인" })).toHaveCount(0);
});

test("clear-all key empties the dots", async ({ page }) => {
  await page.goto("/");
  await press(page, "12");
  await page.getByRole("button", { name: "모두 지우기" }).click();
  await expect(page.locator(".pin-dot.filled")).toHaveCount(0);
});
