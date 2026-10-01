import { defineConfig, devices } from "@playwright/test";

const mobile = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
