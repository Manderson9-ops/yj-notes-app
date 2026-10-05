import { defineConfig, devices } from "@playwright/test";

// 병렬 작업 트리마다 다른 포트(E2E_PORT)를 쓴다: reuseExistingServer 가 다른 트리의 서버를 재사용하지 않게.
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${String(port)}`;

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
  expect: { toMatchSnapshot: { maxDiffPixels: 500, threshold: 0.05 } },
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Desktop Chrome"], ...mobile, isMobile: true } },
    { name: "mobile-webkit", use: { ...devices["Desktop Safari"], ...mobile, isMobile: true } },
  ],
  webServer: {
    command: "npm run dev:mock",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
