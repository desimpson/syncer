import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSqlJs, openPlacesDatabase, resetSqlJsForTests } from "@/services/sql-js-loader";

describe("sql-js-loader", () => {
  it("loads WASM from the plugin output directory and opens a database buffer", async () => {
    resetSqlJsForTests();
    const wasmDirectory = path.join(process.cwd());
    const SQL = await loadSqlJs(wasmDirectory);
    expect(SQL.Database).toBeDefined();

    const database = await openPlacesDatabase(new Uint8Array(), wasmDirectory);
    database.close();
  });
});
