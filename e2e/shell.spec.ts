import { expect, test, type Page } from "@playwright/test";

// Runs against `npm run dev:mock` (FAKE session API; PIN "0000", "1111" = locked).

async function enterPin(page: Page, pin: string) {
  for (const d of pin) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
}

async function login(page: Page) {
  await page.goto("/");
  await enterPin(page, "0000");
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

test("wrong PIN shows a message", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("가족 기록");
  await enterPin(page, "9999");
  await expect(page.getByRole("status").filter({ hasText: "PIN 이 맞지 않아요." })).toBeVisible();
});

test("locked PIN shows the countdown message", async ({ page }) => {
  await page.goto("/");
  await enterPin(page, "1111");
  await expect(page.getByText("잠시 잠겼어요. 2분 뒤에 다시 해 주세요.")).toBeVisible();
});

test("right PIN opens home with 4 tabs", async ({ page }) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  await expect(nav.getByRole("link")).toHaveText(["홈", "기록", "알림장", "자료"]);
});

test("tab navigation", async ({ page }) => {
  await login(page);
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  for (const [name, path] of [
    ["기록", "/logs"],
    ["알림장", "/notes"],
    ["자료", "/library"],
    ["홈", "/"],
  ] as const) {
    await nav.getByRole("link", { name }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    // 홈·알림장은 실제 화면(T-C1). 아직 준비 중인 탭만 자리표시 문구를 확인한다.
    if (name === "기록" || name === "자료") await expect(page.getByText("준비 중")).toBeVisible();
  }
});

test("large text toggle persists after reload", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "설정" }).click();
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-large-text", "1");
  await page.getByRole("switch", { name: "큰 글씨" }).check();
  await expect(html).toHaveAttribute("data-large-text", "1");
  await page.reload();
  await expect(html).toHaveAttribute("data-large-text", "1");
  await expect(page.getByRole("switch", { name: "큰 글씨" })).toBeChecked();
  await expect(page.locator("body")).toHaveCSS("font-size", "20px");
});

test("logout returns to the PIN screen", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "설정" }).click();
  await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
  await expect(page.getByRole("button", { name: "모두 지우기" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "모두 지우기" })).toBeVisible();
});
