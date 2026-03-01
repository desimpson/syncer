import process from "node:process";

import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["**/dist", "**/node_modules", "**/coverage", "**/html", "**/*.d.ts"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
    },
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  { ...unicorn.configs.recommended, files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"] },
  prettierRecommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    rules: {
      // --- base ---
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-alert": "error",
      "no-debugger": "error",
      "no-else-return": "error",
      "no-param-reassign": "error",
      "no-prototype-builtins": "error",
      "no-sequences": "error",
      "object-shorthand": ["error", "always"],
      "prefer-template": "error",

      // --- unicorn ---
      "unicorn/no-array-callback-reference": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-null": "error",
      "unicorn/no-useless-undefined": "off",
      "unicorn/explicit-length-check": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/prefer-object-from-entries": "off",
      "unicorn/prefer-switch": "error",
      "unicorn/prefer-ternary": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      "no-undef": "off",
      "no-console": "off",
      "no-shadow": "off",
      "no-unused-vars": "off",
      // --- typescript ---
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unused-vars": ["error", { args: "all", argsIgnorePattern: "^_" }],
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/prefer-ts-expect-error": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
]);
