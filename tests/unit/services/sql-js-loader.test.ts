import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSqlJs, openPlacesDatabase, resetSqlJsForTests } from "@/services/sql-js-loader";

vi.mock("@/utils/desktop-fs", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("@/utils/desktop-fs")>();
  return {
    ...actual,
    getDesktopNodeModules: () => ({
      fs,
      path,
      os,
    }),
  };
});

describe("sql-js-loader", () => {
  beforeEach(() => {
    resetSqlJsForTests();
  });

  it("loads WASM from the plugin output directory and opens a database buffer", async () => {
    const wasmDirectory = path.join(process.cwd(), "node_modules", "sql.js", "dist");
    const SQL = await loadSqlJs(wasmDirectory);
    expect(SQL.Database).toBeDefined();

    const database = await openPlacesDatabase(new Uint8Array(), wasmDirectory);
    database.close();
  });
});
