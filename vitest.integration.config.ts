import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Ensure the 'obsidian' module resolves to our local test stub in all environments (CI/local)
      obsidian: path.resolve(__dirname, "tests/integration/mocks/obsidian.ts"),
    },
  },
  test: {
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    name: "integration",
  },
});
