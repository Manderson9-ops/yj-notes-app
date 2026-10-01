import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Only server/ is measured (docs/08 Q-UNIT: server/ lines >= 85%).
      // Coverage runs only via `vitest run --coverage` (not part of `npm run check` yet), and
      // include is limited to server/**, so the web project never affects the threshold.
      include: ["server/**/*.ts"],
      exclude: ["server/**/*.test.ts", "server/test-utils/**"],
      // Q-UNIT (docs/08): server/ lines >= 85%, server/auth lines >= 95%.
      thresholds: { lines: 85, "server/auth/**": { lines: 95 } },
    },
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/test/setup.ts"],
          globals: true,
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["server/**/*.test.ts", "tests/**/*.test.ts"],
          globals: true,
        },
      },
      {
        extends: true,
        test: {
          name: "tools",
          environment: "node",
          include: ["tools/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
