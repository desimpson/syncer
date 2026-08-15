import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [tsconfigPaths()],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    alias: {
      // Ensure the 'obsidian' module resolves to our local test stub in all environments (CI/local)
      obsidian: path.resolve(__dirname, "tests/integration/mocks/obsidian.ts"),
      "sql.js/dist/sql-wasm.wasm": path.resolve(
        __dirname,
        "tests/integration/mocks/sql-wasm-binary.ts",
      ),
    },
  },
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/types.ts"],
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 62,
        branches: 82,
      },
    },
  },
});
