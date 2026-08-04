import initSqlJs, { type Database, type SqlJsStatic } from "sql.js/dist/sql-wasm.js";
import { firefoxDebugLog, type FirefoxDebugContext } from "@/services/firefox-debug";
import { getDesktopNodeModules, type NodeFs, type NodePath } from "@/utils/desktop-fs";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

const readFileToBuffer = (fs: NodeFs, filePath: string): Buffer => {
  const contents = fs.readFileSync(filePath);
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
};

const getNodeModules = (debugContext?: FirefoxDebugContext): { fs: NodeFs; path: NodePath } => {
  const desktop = getDesktopNodeModules();
  if (desktop !== undefined) {
    firefoxDebugLog("sql-js-loader: using desktop node modules", undefined, debugContext);
    return desktop;
  }

  const globalWindow = globalThis as typeof globalThis & {
    require?: (moduleId: string) => unknown;
  };
  if (typeof globalWindow.require !== "function") {
    firefoxDebugLog("sql-js-loader: window.require unavailable", undefined, debugContext);
    throw new TypeError("Node modules unavailable; cannot read sql-wasm.wasm");
  }

  firefoxDebugLog("sql-js-loader: using window.require fallback", undefined, debugContext);
  return {
    fs: globalWindow.require("node:fs") as NodeFs,
    path: globalWindow.require("node:path") as NodePath,
  };
};

const readWasmBinary = (wasmDirectory: string, debugContext?: FirefoxDebugContext): Uint8Array => {
  const trimmedDirectory = wasmDirectory.trim();
  firefoxDebugLog(
    "sql-js-loader: readWasmBinary start",
    {
      wasmDirectory,
      trimmedDirectory,
      trimmedLength: trimmedDirectory.length,
    },
    debugContext,
  );
  if (trimmedDirectory.length === 0) {
    throw new Error("Plugin directory is empty; cannot locate sql-wasm.wasm");
  }

  const { fs, path } = getNodeModules(debugContext);
  const wasmPath = path.join(trimmedDirectory, "sql-wasm.wasm");
  firefoxDebugLog(
    "sql-js-loader: resolved wasm path",
    {
      wasmPath,
      wasmExists: fs.existsSync(wasmPath),
    },
    debugContext,
  );
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`sql-wasm.wasm not found at ${wasmPath}`);
  }

  const wasmBinary = new Uint8Array(readFileToBuffer(fs, wasmPath));
  firefoxDebugLog(
    "sql-js-loader: loaded wasm binary",
    { byteLength: wasmBinary.byteLength },
    debugContext,
  );
  return wasmBinary;
};

/**
 * Initialises sql.js once, loading WASM from the plugin directory via Node fs.
 * Electron cannot reliably fetch WASM through locateFile, so the binary is read directly.
 */
export const loadSqlJs = async (
  wasmDirectory: string,
  debugContext?: FirefoxDebugContext,
): Promise<SqlJsStatic> => {
  firefoxDebugLog(
    "sql-js-loader: loadSqlJs",
    {
      hasCachedPromise: sqlJsPromise !== undefined,
    },
    debugContext,
  );
  sqlJsPromise ??= initSqlJs({
    wasmBinary: readWasmBinary(wasmDirectory, debugContext),
  });
  return sqlJsPromise;
};

/**
 * Opens a copied `places.sqlite` buffer as an in-memory sql.js database.
 */
export const openPlacesDatabase = async (
  buffer: Uint8Array,
  wasmDirectory: string,
  debugContext?: FirefoxDebugContext,
): Promise<Database> => {
  firefoxDebugLog(
    "sql-js-loader: openPlacesDatabase",
    { bufferByteLength: buffer.byteLength },
    debugContext,
  );
  const SQL = await loadSqlJs(wasmDirectory, debugContext);
  return new SQL.Database(buffer);
};

/** Resets the cached sql.js initialiser (tests only). */
export const resetSqlJsForTests = (): void => {
  sqlJsPromise = undefined;
};
