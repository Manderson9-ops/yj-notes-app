import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// 로그아웃(S50): 이 기기에 보내지 않은 기록이 있으면 건수를 알리고 「지우고 / 남겨 두고」 를 고르게 한다. FAKE mock API 만 쓴다.

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

/** 이 기기 대기열(IndexedDB)에 보내지 않은 기록 n 건을 넣는다. 앱과 같은 DB 이름·저장소·모양(문자열 실행). */
async function putUnsent(page: Page, n: number) {
  await page.evaluate(`new Promise((resolve, reject) => {
    const req = indexedDB.open("yj-queue", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("pending", { keyPath: "id" }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("pending", "readwrite");
      for (let i = 0; i < ${String(n)}; i++) {
        tx.objectStore("pending").put({
          id: "00000000-0000-7000-8000-00000000000" + i,
          body: { type: "meal", occurredOn: "2020-03-11", recorder: "엄마", payload: {}, note: null, deviceId: "e2e" },
          createdAt: 1000 + i, attempts: 0, status: "pending",
        });
      }
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
    };
  })`);
}

const countUnsent = (page: Page): Promise<number> =>
  page.evaluate<number>(`new Promise((resolve, reject) => {
    const req = indexedDB.open("yj-queue", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("pending", { keyPath: "id" }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const c = db.transaction("pending").objectStore("pending").count();
      c.onsuccess = () => { db.close(); resolve(c.result); };
    };
  })`);

async function openSettingsWithUnsent(page: Page, n: number) {
  // 전송은 막아 둔다: 그래야 기록이 이 기기에 남아 있다.
  await page.route("**/api/logs/*", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );
  await login(page);
  await putUnsent(page, n);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
}

test("기록이 없으면 바로 로그아웃", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
  await expect(page.getByText("PIN 을 눌러 주세요.")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`로그아웃 대화상자: axe 0 (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openSettingsWithUnsent(page, 1);
    await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => v.id)).toEqual([]);
    // 세 단추 모두 손가락으로 누를 크기(48px)
    for (const name of ["취소", "남겨 두고 로그아웃", "지우고 로그아웃"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(47.5);
    }
  });
}

test("보내지 않은 기록이 있으면 건수를 알리고, 남겨 두고 로그아웃", async ({ page }) => {
  await openSettingsWithUnsent(page, 2);
  await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
  const dialog = page.getByRole("dialog", { name: "보내지 않은 기록이 있어요" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("이 기기에 보내지 않은 기록이 2건 있어요.");
  // 취소: 아무것도 바뀌지 않는다
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
  expect(await countUnsent(page)).toBe(2);
  // 남겨 두고 로그아웃: 기록은 그대로
  await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
  await page.getByRole("button", { name: "남겨 두고 로그아웃" }).click();
  await expect(page.getByText("PIN 을 눌러 주세요.")).toBeVisible();
  expect(await countUnsent(page)).toBe(2);
});

test("보내지 않은 기록이 있을 때 지우고 로그아웃", async ({ page }) => {
  await openSettingsWithUnsent(page, 3);
  await page.getByRole("button", { name: "이 기기 로그아웃" }).click();
  await expect(page.getByRole("dialog")).toContainText("3건");
  await page.getByRole("button", { name: "지우고 로그아웃" }).click();
  await expect(page.getByText("PIN 을 눌러 주세요.")).toBeVisible();
  expect(await countUnsent(page)).toBe(0);
});
