export type NodeFs = {
  readFileSync: (filePath: string, encoding?: BufferEncoding) => string | Buffer;
  existsSync: (filePath: string) => boolean;
  statSync: (filePath: string) => { size: number; mtimeMs: number };
  mkdtempSync: (prefix: string) => string;
  copyFileSync: (source: string, destination: string) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  realpathSync: (filePath: string) => string;
  readdirSync: (path: string) => string[];
};

export type NodeOs = {
  tmpdir: () => string;
  homedir: () => string;
};

export type NodePath = {
  join: (...segments: string[]) => string;
  isAbsolute: (filePath: string) => boolean;
  dirname: (filePath: string) => string;
  normalize: (filePath: string) => string;
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
  const browserWindow = window as Window & {
    require?: (moduleId: string) => unknown;
  };
  if (typeof browserWindow.require !== "function") {
    return undefined;
  }

  return {
    fs: browserWindow.require("node:fs") as NodeFs,
    os: browserWindow.require("node:os") as NodeOs,
    path: browserWindow.require("node:path") as NodePath,
  };
};
