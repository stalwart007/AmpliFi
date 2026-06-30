// Flat ESLint config (ESLint 9). Fast, non-type-checked rules so CI stays quick;
// strict `tsc` is the type gate, ESLint catches the rest.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/lib/**", "**/out/**", "**/*.d.ts", "**/*.timestamp-*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
    rules: {
      // Surfaced as a warning (not silenced): `any` is discouraged, and the
      // remaining uses are tracked debt rather than hidden.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "prefer-const": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
);
