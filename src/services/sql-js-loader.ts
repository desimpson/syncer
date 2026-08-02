import initSqlJs, { type Database, type SqlJsStatic } from "sql.js/dist/sql-wasm.js";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

/**
 * Initialises sql.js once, loading WASM from the plugin directory (no remote fetch).
 */
export const loadSqlJs = async (wasmDirectory: string): Promise<SqlJsStatic> => {
  sqlJsPromise ??= initSqlJs({
    locateFile: (file) => `${wasmDirectory}/${file}`,
  });
  return sqlJsPromise;
};

/**
 * Opens a copied `places.sqlite` buffer as an in-memory sql.js database.
 */
export const openPlacesDatabase = async (
  buffer: Uint8Array,
  wasmDirectory: string,
): Promise<Database> => {
  const SQL = await loadSqlJs(wasmDirectory);
  return new SQL.Database(buffer);
};

/** Resets the cached sql.js initialiser (tests only). */
export const resetSqlJsForTests = (): void => {
  sqlJsPromise = undefined;
};
