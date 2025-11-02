import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    name: "unit",
  },
});
