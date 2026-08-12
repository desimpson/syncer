import { describe, expect, it } from "vitest";
import {
  canonicalizePath,
  createFirefoxPathGuard,
  FIREFOX_PROFILE_READ_BASENAMES,
  FIREFOX_TEMP_READ_BASENAMES,
  FirefoxFsGuardError,
  isCanonicalPathUnderRoot,
} from "@/utils/firefox-fs-guard";
import type { NodeFs, NodePath } from "@/utils/desktop-fs";

const makePath = (): NodePath => ({
  join: (...segments: string[]) => segments.join("/").replaceAll("//", "/"),
  isAbsolute: (filePath: string) => filePath.startsWith("/"),
  dirname: (filePath: string) => filePath.split("/").slice(0, -1).join("/") || "/",
  normalize: (filePath: string) => filePath.replaceAll("//", "/"),
});

describe("isCanonicalPathUnderRoot", () => {
  it("accepts exact root and child paths", () => {
    expect(isCanonicalPathUnderRoot("/tmp/syncer", "/tmp/syncer")).toBe(true);
    expect(isCanonicalPathUnderRoot("/tmp/syncer/places.sqlite", "/tmp/syncer")).toBe(true);
  });

  it("rejects sibling paths that share a prefix", () => {
    expect(isCanonicalPathUnderRoot("/tmp/syncer-evil/places.sqlite", "/tmp/syncer")).toBe(false);
  });

  it("compares case-insensitively on win32", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(
        isCanonicalPathUnderRoot(
          String.raw`C:\Program Files\Python312\python.exe`,
          String.raw`c:\program files`,
        ),
      ).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

describe("createFirefoxPathGuard", () => {
  const path = makePath();
  const profileRoot = "/home/user/.mozilla/firefox";
  const profileDirectory = "/home/user/.mozilla/firefox/abc.default-release";

  const fs = {
    realpathSync: (filePath: string) => {
      if (filePath.includes("evil")) {
        throw new Error("missing");
      }
      return filePath;
    },
    existsSync: (filePath: string) => !filePath.includes("missing"),
    mkdtempSync: (prefix: string) => `${prefix}abcd1234`,
    readFileSync: () => Buffer.from(""),
    statSync: () => ({ size: 1, mtimeMs: 1 }),
    copyFileSync: () => undefined,
    rmSync: () => undefined,
    readdirSync: () => [],
  } satisfies NodeFs;

  it("allows profiles.ini under firefox roots", () => {
    const guard = createFirefoxPathGuard({
      fs,
      path,
      firefoxProfileIniRoots: [profileRoot],
    });
    expect(
      guard.assertReadablePath(`${profileRoot}/profiles.ini`, FIREFOX_PROFILE_READ_BASENAMES),
    ).toBe(`${profileRoot}/profiles.ini`);
  });

  it("rejects disallowed basenames", () => {
    const guard = createFirefoxPathGuard({
      fs,
      path,
      firefoxProfileIniRoots: [profileRoot],
      profileDirectory,
    });
    expect(() =>
      guard.assertReadablePath(`${profileDirectory}/passwd`, FIREFOX_PROFILE_READ_BASENAMES),
    ).toThrow(FirefoxFsGuardError);
  });

  it("rejects paths outside allowed roots", () => {
    const guard = createFirefoxPathGuard({
      fs,
      path,
      firefoxProfileIniRoots: [profileRoot],
      profileDirectory,
    });
    expect(() => guard.assertReadablePath("/etc/passwd", FIREFOX_PROFILE_READ_BASENAMES)).toThrow(
      FirefoxFsGuardError,
    );
  });

  it("scopes writes to the mkdtemp directory for this operation", () => {
    const guard = createFirefoxPathGuard({
      fs,
      path,
      firefoxProfileIniRoots: [profileRoot],
      profileDirectory,
    });
    const temporaryDirectory = guard.createTempDirectory("/tmp/syncer-firefox-");
    expect(temporaryDirectory).toBe("/tmp/syncer-firefox-abcd1234");
    expect(
      guard.assertWritablePath(`${temporaryDirectory}/places.sqlite`, FIREFOX_TEMP_READ_BASENAMES),
    ).toBe(`${temporaryDirectory}/places.sqlite`);
    expect(() =>
      guard.assertWritablePath(
        "/tmp/other-syncer-firefox-/places.sqlite",
        FIREFOX_TEMP_READ_BASENAMES,
      ),
    ).toThrow(FirefoxFsGuardError);
  });

  it("skips missing Firefox profile roots instead of failing guard construction", () => {
    const selectiveFs = {
      ...fs,
      existsSync: (filePath: string) =>
        filePath === profileRoot || filePath.startsWith(profileRoot),
      realpathSync: (filePath: string) => {
        if (filePath.includes("snap") || filePath.includes("flatpak")) {
          throw new Error("missing");
        }
        return filePath;
      },
    } satisfies NodeFs;

    const guard = createFirefoxPathGuard({
      fs: selectiveFs,
      path,
      firefoxProfileIniRoots: [
        profileRoot,
        "/home/user/snap/firefox/common/.mozilla/firefox",
        "/home/user/.var/app/org.mozilla.firefox/.mozilla/firefox",
      ],
    });
    expect(
      guard.assertReadablePath(`${profileRoot}/profiles.ini`, FIREFOX_PROFILE_READ_BASENAMES),
    ).toBe(`${profileRoot}/profiles.ini`);
  });
});

describe("canonicalizePath", () => {
  it("throws when realpath fails", () => {
    const fs = {
      realpathSync: () => {
        throw new Error("missing");
      },
    } as unknown as NodeFs;
    expect(() => canonicalizePath(fs, "/missing")).toThrow(FirefoxFsGuardError);
  });
});
