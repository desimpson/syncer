import type { NodeFs, NodePath } from "@/utils/desktop-fs";

/** Basenames readable from a Firefox profile directory or profiles.ini roots. */
export const FIREFOX_PROFILE_READ_BASENAMES = new Set([
  "profiles.ini",
  "places.sqlite",
  "places.sqlite-wal",
]);

/** Basenames allowed under a Syncer mkdtemp hot-copy directory. */
export const FIREFOX_TEMP_READ_BASENAMES = new Set([
  "places.sqlite",
  "places.sqlite-wal",
  "merged.sqlite",
]);

export class FirefoxFsGuardError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FirefoxFsGuardError";
  }
}

const pathBasename = (filePath: string): string => {
  const parts: string[] = filePath.split(/[/\\]/u);
  if (parts.length === 0) {
    return "";
  }
  // eslint-disable-next-line unicorn/prefer-at -- ES2021 target; Array#at requires ES2022 lib
  return parts[parts.length - 1] ?? "";
};

const pathSeparator = (filePath: string): "/" | "\\" => (filePath.includes("\\") ? "\\" : "/");

export const isCanonicalPathUnderRoot = (canonicalPath: string, canonicalRoot: string): boolean => {
  if (canonicalPath === canonicalRoot) {
    return true;
  }
  const separator = pathSeparator(canonicalRoot);
  const rootWithSeparator = canonicalRoot.endsWith(separator)
    ? canonicalRoot
    : `${canonicalRoot}${separator}`;
  return canonicalPath.startsWith(rootWithSeparator);
};

export const canonicalizePath = (fs: NodeFs, filePath: string): string => {
  try {
    return fs.realpathSync(filePath);
  } catch {
    throw new FirefoxFsGuardError(`Path is not accessible: ${filePath}`);
  }
};

const assertBasenameAllowed = (
  canonicalPath: string,
  allowedBasenames: ReadonlySet<string>,
): void => {
  const basename = pathBasename(canonicalPath);
  if (!allowedBasenames.has(basename)) {
    throw new FirefoxFsGuardError(`Filename is not allowed for Firefox sync: ${basename}`);
  }
};

export type FirefoxPathGuard = {
  readonly canonicalProfileDirectory: string | undefined;
  readonly canonicalTempDirectory: string | undefined;
  assertReadablePath: (filePath: string, allowedBasenames: ReadonlySet<string>) => string;
  assertWritablePath: (filePath: string, allowedBasenames: ReadonlySet<string>) => string;
  assertRemovablePath: (filePath: string) => string;
  createTempDirectory: (prefix: string) => string;
};

export type CreateFirefoxPathGuardOptions = {
  fs: NodeFs;
  path: NodePath;
  firefoxProfileIniRoots: readonly string[];
  profileDirectory?: string;
};

/**
 * Scoped path guard for Firefox bookmark file I/O outside the vault.
 * All reads/writes must pass basename + canonical-root checks.
 */
export const createFirefoxPathGuard = ({
  fs,
  path,
  firefoxProfileIniRoots,
  profileDirectory,
}: CreateFirefoxPathGuardOptions): FirefoxPathGuard => {
  const canonicalIniRoots = firefoxProfileIniRoots.map((root) => canonicalizePath(fs, root));
  const canonicalProfileDirectory =
    profileDirectory === undefined ? undefined : canonicalizePath(fs, profileDirectory);

  let canonicalTemporaryDirectory: string | undefined;

  const allowedReadRoots = (): readonly string[] => {
    const roots = [...canonicalIniRoots];
    if (canonicalProfileDirectory !== undefined) {
      roots.push(canonicalProfileDirectory);
    }
    if (canonicalTemporaryDirectory !== undefined) {
      roots.push(canonicalTemporaryDirectory);
    }
    return roots;
  };

  const assertUnderAllowedRoot = (canonicalPath: string): void => {
    if (!allowedReadRoots().some((root) => isCanonicalPathUnderRoot(canonicalPath, root))) {
      throw new FirefoxFsGuardError(`Path is outside allowed Firefox scope: ${canonicalPath}`);
    }
  };

  const assertReadablePath = (filePath: string, allowedBasenames: ReadonlySet<string>): string => {
    const canonicalPath = canonicalizePath(fs, filePath);
    assertBasenameAllowed(canonicalPath, allowedBasenames);
    assertUnderAllowedRoot(canonicalPath);
    return canonicalPath;
  };

  const assertWritablePath = (filePath: string, allowedBasenames: ReadonlySet<string>): string => {
    if (canonicalTemporaryDirectory === undefined) {
      throw new FirefoxFsGuardError("No temporary directory is active for Firefox sync writes.");
    }
    const normalisedPath = path.normalize(filePath);
    assertBasenameAllowed(normalisedPath, allowedBasenames);
    const parentPath = path.dirname(normalisedPath);
    const canonicalParent = canonicalizePath(fs, parentPath);
    if (!isCanonicalPathUnderRoot(canonicalParent, canonicalTemporaryDirectory)) {
      throw new FirefoxFsGuardError(
        `Write path is outside the Firefox temp directory: ${normalisedPath}`,
      );
    }
    return normalisedPath;
  };

  const assertRemovablePath = (filePath: string): string => {
    if (canonicalTemporaryDirectory === undefined) {
      throw new FirefoxFsGuardError("No temporary directory is active for Firefox sync cleanup.");
    }
    const canonicalPath = canonicalizePath(fs, filePath);
    if (
      canonicalPath !== canonicalTemporaryDirectory &&
      !isCanonicalPathUnderRoot(canonicalPath, canonicalTemporaryDirectory)
    ) {
      throw new FirefoxFsGuardError(
        `Remove path is outside the Firefox temp directory: ${canonicalPath}`,
      );
    }
    return canonicalPath;
  };

  const createTemporaryDirectory = (prefix: string): string => {
    if (!prefix.includes("syncer-firefox-")) {
      throw new FirefoxFsGuardError(
        "Firefox temp directories must use the syncer-firefox- prefix.",
      );
    }
    const temporaryDirectory = fs.mkdtempSync(prefix);
    canonicalTemporaryDirectory = canonicalizePath(fs, temporaryDirectory);
    return canonicalTemporaryDirectory;
  };

  return {
    get canonicalProfileDirectory() {
      return canonicalProfileDirectory;
    },
    get canonicalTempDirectory() {
      return canonicalTemporaryDirectory;
    },
    assertReadablePath,
    assertWritablePath,
    assertRemovablePath,
    createTempDirectory: createTemporaryDirectory,
  };
};
