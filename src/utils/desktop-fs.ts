export type NodeFs = {
  readFileSync: (filePath: string, encoding?: BufferEncoding) => string | Buffer;
  existsSync: (filePath: string) => boolean;
  statSync: (filePath: string) => { size: number; mtimeMs: number };
  mkdtempSync: (prefix: string) => string;
  copyFileSync: (source: string, destination: string) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};

export type NodeOs = {
  tmpdir: () => string;
  homedir: () => string;
};

export type NodePath = {
  join: (...segments: string[]) => string;
  isAbsolute: (filePath: string) => boolean;
};

type DesktopNodeModules = {
  fs: NodeFs;
  os: NodeOs;
  path: NodePath;
};

/**
 * Returns Node fs/os/path modules in Obsidian desktop (Electron renderer).
 * Uses `window.require` because dynamic `import('node:fs')` is blocked in the renderer.
 */
export const getDesktopNodeModules = (): DesktopNodeModules | undefined => {
  const globalWindow = globalThis as typeof globalThis & {
    require?: (moduleId: string) => unknown;
  };
  if (typeof globalWindow.require !== "function") {
    return undefined;
  }

  return {
    fs: globalWindow.require("node:fs") as NodeFs,
    os: globalWindow.require("node:os") as NodeOs,
    path: globalWindow.require("node:path") as NodePath,
  };
};
