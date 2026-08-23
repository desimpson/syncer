import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeFs, NodeOs, NodePath } from "@/utils/desktop-fs";
import { fetchFirefoxBookmarkFolders, FirefoxBookmarksError } from "@/services/firefox-bookmarks";
import { FIREFOX_NOTICE } from "@/services/firefox-messages";

const { fs, os, path } = vi.hoisted(() => {
  const fs: NodeFs = {
    existsSync: vi.fn(() => false),
    realpathSync: vi.fn((filePath: string) => {
      throw new Error(`missing: ${filePath}`);
    }),
    readFileSync: () => {
      throw new Error("not implemented");
    },
    statSync: () => ({ size: 0, mtimeMs: 0 }),
    mkdtempSync: (prefix: string) => `${prefix}test`,
    copyFileSync: () => undefined,
    rmSync: () => undefined,
    readdirSync: () => [],
  };
  const os: NodeOs = {
    homedir: () => "/home/user",
    tmpdir: () => "/tmp",
  };
  const path: NodePath = {
    join: (...segments: string[]) => segments.join("/").replaceAll("//", "/"),
    isAbsolute: (filePath: string) => filePath.startsWith("/"),
    dirname: (filePath: string) => filePath.split("/").slice(0, -1).join("/") || "/",
    normalize: (filePath: string) => filePath.replaceAll("//", "/"),
  };
  return { fs, os, path };
});

vi.mock("@/utils/desktop-fs", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("@/utils/desktop-fs")>();
  return {
    ...actual,
    getDesktopNodeModules: () => ({ fs, os, path }),
  };
});

const withLinuxPlatform = async (run: () => Promise<void>): Promise<void> => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    await run();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
};

describe("fetchFirefoxBookmarkFolders", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset().mockReturnValue(false);
    vi.mocked(fs.realpathSync)
      .mockReset()
      .mockImplementation((filePath: string) => {
        throw new Error(`missing: ${filePath}`);
      });
  });

  it("maps missing Firefox profile roots to a user-facing profile error", async () => {
    // Arrange
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });

    try {
      // Act & Assert
      await expect(fetchFirefoxBookmarkFolders("", "/unused-wasm")).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof FirefoxBookmarksError &&
          error.userMessage === FIREFOX_NOTICE.profilePathNotFound,
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("treats an accessible XDG profile root with no profiles.ini as profile-not-found", async () => {
    // Arrange
    const xdgRoot = "/home/user/.config/mozilla/firefox";
    vi.mocked(fs.existsSync).mockImplementation((filePath: string) => filePath === xdgRoot);
    vi.mocked(fs.realpathSync).mockImplementation((filePath: string) => filePath);

    // Act & Assert
    await withLinuxPlatform(async () => {
      await expect(fetchFirefoxBookmarkFolders("", "/unused-wasm")).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof FirefoxBookmarksError &&
          error.userMessage === FIREFOX_NOTICE.profilePathNotFound,
      );
    });
  });
});
