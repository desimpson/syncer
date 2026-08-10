import initSqlJs, { type Database, type SqlJsStatic } from "sql.js/dist/sql-wasm.js";
import sqlWasmBinary from "sql.js/dist/sql-wasm.wasm";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

/**
 * Initialises sql.js once with a bundled WASM binary.
 * This keeps Firefox Bookmarks compatible with Community plugin installs, which
 * only download `main.js`, `manifest.json`, and optional `styles.css`.
 */
export const loadSqlJs = async (
  _wasmDirectory: string,
  _debugContext?: unknown,
): Promise<SqlJsStatic> => {
  sqlJsPromise ??= initSqlJs({
    wasmBinary: sqlWasmBinary,
  });
  return sqlJsPromise;
};

/**
 * Opens a copied `places.sqlite` buffer as an in-memory sql.js database.
 */
export const openPlacesDatabase = async (
  buffer: Uint8Array,
  wasmDirectory: string,
  _debugContext?: unknown,
): Promise<Database> => {
  const SQL = await loadSqlJs(wasmDirectory);
  return new SQL.Database(buffer);
};

/** Resets the cached sql.js initialiser (tests only). */
export const resetSqlJsForTests = (): void => {
  sqlJsPromise = undefined;
};
