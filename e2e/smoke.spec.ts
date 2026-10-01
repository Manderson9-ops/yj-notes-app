import { expect, test } from "@playwright/test";

test("app shell renders the title and home heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("가족 기록");
  await expect(page.getByText("가족 기록", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "기록" })).toBeVisible();
});
