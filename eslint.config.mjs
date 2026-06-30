// Flat ESLint config (ESLint 9). Fast, non-type-checked rules so CI stays quick;
// strict `tsc` is the type gate, ESLint catches the rest.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "prefer-const": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
);
