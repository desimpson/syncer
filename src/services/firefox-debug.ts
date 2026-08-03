import { getDesktopNodeModules } from "@/utils/desktop-fs";

/** Temporary debug prefix — remove once Firefox WASM path issue is resolved. */
export const FIREFOX_DEBUG_PREFIX = "[Syncer Firefox debug]";

type DebugPayload = Record<string, unknown>;

export const firefoxDebugLog = (message: string, payload?: DebugPayload): void => {
  if (payload === undefined) {
    console.log(FIREFOX_DEBUG_PREFIX, message);
    return;
  }
  console.log(FIREFOX_DEBUG_PREFIX, message, payload);
};

export const firefoxDebugWarn = (message: string, payload?: DebugPayload): void => {
  if (payload === undefined) {
    console.warn(FIREFOX_DEBUG_PREFIX, message);
    return;
  }
  console.warn(FIREFOX_DEBUG_PREFIX, message, payload);
};

export const firefoxDebugError = (message: string, payload?: DebugPayload): void => {
  if (payload === undefined) {
    console.error(FIREFOX_DEBUG_PREFIX, message);
    return;
  }
  console.error(FIREFOX_DEBUG_PREFIX, message, payload);
};

const getFsWithReaddir = ():
  | {
      existsSync: (path: string) => boolean;
      readdirSync: (path: string) => string[];
    }
  | undefined => {
  const globalWindow = globalThis as typeof globalThis & {
    require?: (moduleId: string) => unknown;
  };
  if (typeof globalWindow.require !== "function") {
    return undefined;
  }

  return globalWindow.require("node:fs") as {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => string[];
  };
};

/** Logs plugin directory candidates and directory listing when Node fs is available. */
export const logPluginDirectoryDiagnostics = (context: {
  label: string;
  resolvedPluginDirectory: string;
  manifestDir?: string | undefined;
  vaultBasePath?: string | undefined;
}): void => {
  const { label, resolvedPluginDirectory, manifestDir, vaultBasePath } = context;
  const fs = getFsWithReaddir();

  firefoxDebugLog(`${label}: path resolution`, {
    resolvedPluginDirectory,
    manifestDir: manifestDir ?? "(undefined)",
    vaultBasePath: vaultBasePath ?? "(undefined)",
    desktopNodeModulesAvailable: getDesktopNodeModules() !== undefined,
    windowRequireAvailable: typeof (globalThis as { require?: unknown }).require === "function",
  });

  const directoriesToInspect = [
    { label: "resolvedPluginDirectory", path: resolvedPluginDirectory },
    ...(manifestDir !== undefined && manifestDir.length > 0
      ? [{ label: "manifest.dir (raw)", path: manifestDir }]
      : []),
  ];

  if (fs === undefined) {
    firefoxDebugWarn(`${label}: cannot list directories — Node fs unavailable`);
    return;
  }

  for (const directory of directoriesToInspect) {
    if (directory.path.length === 0) {
      firefoxDebugWarn(`${label}: ${directory.label} is empty`);
      continue;
    }

    const wasmPath = `${directory.path}/sql-wasm.wasm`;
    firefoxDebugLog(`${label}: inspect ${directory.label}`, {
      path: directory.path,
      exists: fs.existsSync(directory.path),
      wasmPath,
      wasmExists: fs.existsSync(wasmPath),
      entries: fs.existsSync(directory.path) ? fs.readdirSync(directory.path) : [],
    });
  }
};

export const logWasmLoadAttempt = (wasmDirectory: string): void => {
  const fs = getFsWithReaddir();
  const trimmedDirectory = wasmDirectory.trim();

  firefoxDebugLog("loadWasm: start", {
    wasmDirectory,
    trimmedDirectory,
    trimmedLength: trimmedDirectory.length,
    desktopNodeModulesAvailable: getDesktopNodeModules() !== undefined,
  });

  if (fs === undefined || trimmedDirectory.length === 0) {
    return;
  }

  const wasmPath = `${trimmedDirectory}/sql-wasm.wasm`;
  firefoxDebugLog("loadWasm: resolved path", {
    wasmPath,
    wasmExists: fs.existsSync(wasmPath),
    parentExists: fs.existsSync(trimmedDirectory),
    parentEntries: fs.existsSync(trimmedDirectory) ? fs.readdirSync(trimmedDirectory) : [],
  });
};

export const logPlacesDatabaseAttempt = (context: {
  profileDirectory: string;
  wasmDirectory: string;
  bufferByteLength: number;
  walSidecarsPresent: boolean;
}): void => {
  firefoxDebugLog("openPlacesDatabase: start", context);
};

export const logPlacesDatabaseFailure = (context: {
  wasmDirectory: string;
  error: unknown;
}): void => {
  firefoxDebugError("openPlacesDatabase: failed", {
    wasmDirectory: context.wasmDirectory,
    errorMessage: context.error instanceof Error ? context.error.message : String(context.error),
    errorName: context.error instanceof Error ? context.error.name : typeof context.error,
    errorStack: context.error instanceof Error ? context.error.stack : undefined,
    errorCause:
      context.error instanceof Error && "cause" in context.error ? context.error.cause : undefined,
  });
};
