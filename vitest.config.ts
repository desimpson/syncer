import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      obsidian: "/home/daniel/code/obsidian-syncer/tests/mocks/obsidian.ts",
    },
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
