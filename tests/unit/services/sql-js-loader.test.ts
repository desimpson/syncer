import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSqlJs, openPlacesDatabase, resetSqlJsForTests } from "@/services/sql-js-loader";

const { initSqlJsMock } = vi.hoisted(() => ({
  initSqlJsMock: vi.fn(async () => ({
    Database: class {
      public close = vi.fn();
    },
  })),
}));

vi.mock("sql.js/dist/sql-wasm.js", () => ({
  default: initSqlJsMock,
}));

describe("sql-js-loader", () => {
  beforeEach(() => {
    initSqlJsMock.mockClear();
    resetSqlJsForTests();
  });

  it("loads bundled WASM and opens a database buffer", async () => {
    const wasmDirectory = "";
    const SQL = await loadSqlJs(wasmDirectory);
    expect(SQL.Database).toBeDefined();
    expect(initSqlJsMock).toHaveBeenCalledTimes(1);

    const database = await openPlacesDatabase(new Uint8Array(), wasmDirectory);
    database.close();
  });
});
