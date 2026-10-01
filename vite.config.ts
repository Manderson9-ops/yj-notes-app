import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mockApi } from "./vite-plugins/mock-api.ts";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  // mockApi is serve-only (apply: "serve") and gated by VITE_MOCK_API=1: never in a build.
  plugins: [react(), ...(process.env.VITE_MOCK_API === "1" ? [mockApi()] : [])],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { sourcemap: false },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
