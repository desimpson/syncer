import type { NodeFs, NodePath, NodeOs } from "@/utils/desktop-fs";
import { canonicalizePath, isCanonicalPathUnderRoot } from "@/utils/firefox-fs-guard";

export type TrustedBinaryName = "sqlite3" | "python3";

const UNIX_SQLITE_CANDIDATES = [
  "/usr/bin/sqlite3",
  "/bin/sqlite3",
  "/usr/local/bin/sqlite3",
  "/opt/homebrew/bin/sqlite3",
  "/usr/local/opt/sqlite/bin/sqlite3",
] as const;

const UNIX_PYTHON_CANDIDATES = [
  "/usr/bin/python3",
  "/bin/python3",
  "/usr/local/bin/python3",
  "/opt/homebrew/bin/python3",
] as const;

const UNIX_TRUSTED_BIN_ROOTS = [
  "/usr/bin",
  "/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/local/opt",
] as const;

const windowsTrustedBinRoots = (os: NodeOs): string[] => {
  const home = os.homedir();
  return [
    `${process.env["LOCALAPPDATA"] ?? ""}\\Programs`,
    `${process.env["ProgramFiles"] ?? String.raw`C:\Program Files`}`,
    `${process.env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`}`,
    `${process.env["ProgramData"] ?? String.raw`C:\ProgramData`}\\chocolatey\\bin`,
    `${home}\\scoop\\shims`,
  ].filter((root) => root.length > 0);
};

const isTrustedUnixBinaryPath = (fs: NodeFs, candidatePath: string): boolean => {
  if (!fs.existsSync(candidatePath)) {
    return false;
  }
  let canonical: string;
  try {
    canonical = canonicalizePath(fs, candidatePath);
  } catch {
    return false;
  }
  return UNIX_TRUSTED_BIN_ROOTS.some((root) => {
    try {
      const canonicalRoot = canonicalizePath(fs, root);
      return isCanonicalPathUnderRoot(canonical, canonicalRoot);
    } catch {
      return false;
    }
  });
};

const listWindowsVersionedCandidates = (
  fs: NodeFs,
  parentDirectory: string,
  directoryPrefix: RegExp,
  executableName: string,
): string[] => {
  if (parentDirectory.length === 0 || !fs.existsSync(parentDirectory)) {
    return [];
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(parentDirectory);
  } catch {
    return [];
  }
  const matchingEntries: string[] = entries.filter((entry) => directoryPrefix.test(entry));
  matchingEntries.sort((left, right) => right.localeCompare(left));
  return matchingEntries.map((entry) => `${parentDirectory}\\${entry}\\${executableName}`);
};

const buildWindowsCandidates = (fs: NodeFs, binaryName: TrustedBinaryName): string[] => {
  const localAppData = process.env["LOCALAPPDATA"] ?? "";
  const programFiles = process.env["ProgramFiles"] ?? String.raw`C:\Program Files`;
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`;
  const programData = process.env["ProgramData"] ?? String.raw`C:\ProgramData`;
  const home = process.env["USERPROFILE"] ?? "";

  if (binaryName === "python3") {
    return [
      ...listWindowsVersionedCandidates(
        fs,
        `${localAppData}\\Programs\\Python`,
        /^Python/i,
        "python.exe",
      ),
      ...listWindowsVersionedCandidates(fs, programFiles, /^Python/i, "python.exe"),
      ...listWindowsVersionedCandidates(fs, programFilesX86, /^Python/i, "python.exe"),
      `${programData}\\chocolatey\\bin\\python.exe`,
      `${home}\\scoop\\shims\\python.exe`,
    ];
  }

  return [
    ...listWindowsVersionedCandidates(fs, programFiles, /^Sqlite/i, "sqlite3.exe"),
    `${programData}\\chocolatey\\bin\\sqlite3.exe`,
    `${home}\\scoop\\shims\\sqlite3.exe`,
  ];
};

const isTrustedWindowsBinaryPath = (fs: NodeFs, os: NodeOs, candidatePath: string): boolean => {
  if (!fs.existsSync(candidatePath)) {
    return false;
  }
  let canonical: string;
  try {
    canonical = canonicalizePath(fs, candidatePath);
  } catch {
    return false;
  }
  return windowsTrustedBinRoots(os).some((root) => {
    try {
      const canonicalRoot = canonicalizePath(fs, root);
      return isCanonicalPathUnderRoot(canonical, canonicalRoot);
    } catch {
      return false;
    }
  });
};

const resolveFromPathEntries = (
  fs: NodeFs,
  path: NodePath,
  binaryName: TrustedBinaryName,
): string | undefined => {
  const pathValue = process.env["PATH"] ?? "";
  if (pathValue.length === 0) {
    return undefined;
  }
  const executable = binaryName === "python3" ? "python3" : "sqlite3";
  for (const entry of pathValue.split(":")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const candidate = path.join(trimmed, executable);
    if (isTrustedUnixBinaryPath(fs, candidate)) {
      return canonicalizePath(fs, candidate);
    }
  }
  return undefined;
};

/**
 * Resolves an absolute, realpath-verified sqlite3 or python3 binary under trusted bin roots.
 * Returns undefined when no trusted binary is available (caller should soft-fail WAL merge).
 */
export const resolveTrustedBinary = (
  fs: NodeFs,
  path: NodePath,
  os: NodeOs,
  binaryName: TrustedBinaryName,
): string | undefined => {
  if (process.platform === "win32") {
    for (const candidate of buildWindowsCandidates(fs, binaryName)) {
      if (isTrustedWindowsBinaryPath(fs, os, candidate)) {
        return canonicalizePath(fs, candidate);
      }
    }
    return undefined;
  }

  const fixedCandidates =
    binaryName === "sqlite3" ? UNIX_SQLITE_CANDIDATES : UNIX_PYTHON_CANDIDATES;
  for (const candidate of fixedCandidates) {
    if (isTrustedUnixBinaryPath(fs, candidate)) {
      return canonicalizePath(fs, candidate);
    }
  }

  return resolveFromPathEntries(fs, path, binaryName);
};
