import process from "node:process";

import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import importPlugin from "eslint-plugin-import";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import prettier from "eslint-plugin-prettier";

export default defineConfig([
  {
    ignores: ["**/dist", "**/node_modules", "**/coverage", "**/html", "**/*.d.ts"],
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".mjs", ".ts", ".tsx", ".json"],
        },
        typescript: {
          project: ["./tsconfig.json"],
        },
      },
    },
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: "2021",
      sourceType: "module",
    },
    plugins: {
      prettier,
      importPlugin,
    },
    rules: {
      "prettier/prettier": "error",
      "no-console": "warn",
      "no-debugger": "error",
    },
  },
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  unicorn.configs.recommended,
  importPlugin.flatConfigs.recommended,
  prettierRecommended, // last to avoid conflicts
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      // --- base ---
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "no-alert": "error",
      "no-console": "off",
      "no-debugger": "error",
      "no-prototype-builtins": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/services/*/*.types"],
              message: "Import the type from the public service file, not the internal .types file",
            },
            // TODO: Block imports from other internal files, e.g., "@/integrations/*"
          ],
        },
      ],
      "no-return-await": "error",
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
      "@typescript-eslint/no-unused-vars": ["error", { args: "all", argsIgnorePattern: "^_" }],
      "@typescript-eslint/prefer-ts-expect-error": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",

      // --- unicorn ---
      "unicorn/no-array-callback-reference": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-null": "warn",
      "unicorn/no-useless-undefined": "off",
      "unicorn/explicit-length-check": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/prefer-object-from-entries": "off",
      "unicorn/prefer-switch": "warn",
      "unicorn/prefer-ternary": "error",

      // -- import ---
      "import/no-unused-modules": ["error", { unusedExports: true }],
    },
  },
]);
