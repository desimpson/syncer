import initSqlJs, { type Database, type SqlJsStatic } from "sql.js/dist/sql-wasm.js";
import { getDesktopNodeModules, type NodeFs, type NodePath } from "@/utils/desktop-fs";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

const readFileToBuffer = (fs: NodeFs, filePath: string): Buffer => {
  const contents = fs.readFileSync(filePath);
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
};

const getNodeModules = (): { fs: NodeFs; path: NodePath } => {
  const desktop = getDesktopNodeModules();
  if (desktop !== undefined) {
    return desktop;
  }

  const globalWindow = globalThis as typeof globalThis & {
    require?: (moduleId: string) => unknown;
  };
  if (typeof globalWindow.require !== "function") {
    throw new TypeError("Node modules unavailable; cannot read sql-wasm.wasm");
  }

  return {
    fs: globalWindow.require("node:fs") as NodeFs,
    path: globalWindow.require("node:path") as NodePath,
  };
};

const readWasmBinary = (wasmDirectory: string): Uint8Array => {
  const trimmedDirectory = wasmDirectory.trim();
  if (trimmedDirectory.length === 0) {
    throw new Error("Plugin directory is empty; cannot locate sql-wasm.wasm");
  }

  const { fs, path } = getNodeModules();
  const wasmPath = path.join(trimmedDirectory, "sql-wasm.wasm");
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`sql-wasm.wasm not found at ${wasmPath}`);
  }

  return new Uint8Array(readFileToBuffer(fs, wasmPath));
};

/**
 * Initialises sql.js once, loading WASM from the plugin directory via Node fs.
 * Electron cannot reliably fetch WASM through locateFile, so the binary is read directly.
 */
export const loadSqlJs = async (wasmDirectory: string): Promise<SqlJsStatic> => {
  sqlJsPromise ??= initSqlJs({
    wasmBinary: readWasmBinary(wasmDirectory),
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
