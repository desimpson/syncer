import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import { resolvePluginDirectory } from "@/plugin/plugin-directory";

vi.mock("@/utils/desktop-fs", () => ({
  getDesktopNodeModules: () => ({
    fs: {},
    os: {},
    path: {
      join: (...segments: string[]) => segments.join("/").replaceAll("//", "/"),
      isAbsolute: (filePath: string) => filePath.startsWith("/"),
    },
  }),
}));

const makeApp = (basePath: string | undefined): App =>
  ({
    vault: {
      adapter:
        basePath === undefined
          ? {}
          : {
              getBasePath: () => basePath,
            },
    },
  }) as unknown as App;

describe("resolvePluginDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins vault base path with vault-relative manifest.dir", () => {
    const app = makeApp("/home/user/Documents/Obsidian Dev Vault");
    // Obsidian supplies vault-relative plugin dirs; shape mirrored for join logic only.
    const manifest = { dir: "plugins/obsidian-syncer" } as PluginManifest;

    expect(resolvePluginDirectory(app, manifest)).toBe(
      "/home/user/Documents/Obsidian Dev Vault/plugins/obsidian-syncer",
    );
  });

  it("returns absolute manifest.dir unchanged", () => {
    const app = makeApp("/vault");
    const manifest = { dir: "/absolute/plugins/syncer" } as PluginManifest;

    expect(resolvePluginDirectory(app, manifest)).toBe("/absolute/plugins/syncer");
  });

  it("returns relative manifest.dir when vault base path is unavailable", () => {
    const app = makeApp(undefined);
    const manifest = { dir: "plugins/obsidian-syncer" } as PluginManifest;

    expect(resolvePluginDirectory(app, manifest)).toBe("plugins/obsidian-syncer");
  });
});
