import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "playwright-report", "test-results", "node_modules", ".wrangler"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  { files: ["src/**/*.{ts,tsx}"], ...jsxA11y.flatConfigs.recommended },
  {
    files: ["*.config.{js,ts}", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  { files: ["eslint.config.js"], ...tseslint.configs.disableTypeChecked },
);
