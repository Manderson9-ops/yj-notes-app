import { defineConfig, devices } from "@playwright/test";

const mobile = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 시각 회귀(toHaveScreenshot 대신 toMatchSnapshot): 기준 PNG 는 e2e/__screenshots__/<화면>-<테마>-<scheme>.png 와 같은 파일(G2 허용 경로).
  // OS 별 렌더가 달라 비교는 로컬 win32 에서만 한다(e2e/helpers.ts). 갱신: npx playwright test --update-snapshots
  snapshotDir: "./e2e/__screenshots__",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0.002 } },
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Desktop Chrome"], ...mobile, isMobile: true } },
    { name: "mobile-webkit", use: { ...devices["Desktop Safari"], ...mobile, isMobile: true } },
  ],
  webServer: {
    command: "npm run dev:mock",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
