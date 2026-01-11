import { describe, it, expect, beforeEach, vi } from "vitest";
import ObsidianSyncerPlugin from "@/plugin";
import type { App, PluginManifest, TFile, Vault } from "obsidian";

// Minimal stubs for constructor args
const mockApp = {} as unknown as App;
const mockManifest = {
  id: "obsidian-syncer",
  name: "Obsidian Syncer",
  version: "0.0.0",
} as unknown as PluginManifest;

describe("Plugin settings method binding", () => {
  beforeEach(() => {
    // Ensure required env vars for constructor schema parse
    process.env["GOOGLE_CLIENT_ID"] = process.env["GOOGLE_CLIENT_ID"] ?? "test-client-id";
  });

  it("allows calling load/save/update after destructuring (bound methods)", async () => {
    // Arrange
    const plugin = new ObsidianSyncerPlugin(mockApp, mockManifest);
    const { loadSettings, saveSettings, updateSettings } = plugin; // destructuring used to lose `this`

    // Act
    const loadResult = loadSettings();
    const saveResult = (async () => {
      const current = await plugin.loadSettings();
      return saveSettings(current);
    })();
    const updateResult = updateSettings({ syncIntervalMinutes: 7 });

    // Assert
    await expect(loadResult).resolves.toBeDefined();
    await expect(saveResult).resolves.toBeUndefined();
    await expect(updateResult).resolves.toBeUndefined();
  });
});

describe("Plugin file content cache initialization", () => {
  beforeEach(() => {
    // Ensure required env vars for constructor schema parse
    process.env["GOOGLE_CLIENT_ID"] = process.env["GOOGLE_CLIENT_ID"] ?? "test-client-id";
  });

  it("re-initializes cache when syncDocument changes", async () => {
    // Arrange
    const file1Content = "# File 1\n- Task 1";
    const file2Content = "# File 2\n- Task 2";
    const defaultFileContent = "# Default\n- Task";

    const defaultFile: TFile = {
      path: "GTD.md",
      vault: {
        cachedRead: vi.fn().mockResolvedValue(defaultFileContent),
      } as unknown as Vault,
    } as unknown as TFile;

    const file1: TFile = {
      path: "File1.md",
      vault: {
        cachedRead: vi.fn().mockResolvedValue(file1Content),
      } as unknown as Vault,
    } as unknown as TFile;

    const file2: TFile = {
      path: "File2.md",
      vault: {
        cachedRead: vi.fn().mockResolvedValue(file2Content),
      } as unknown as Vault,
    } as unknown as TFile;

    const getFileByPath = vi.fn((path: string) => {
      if (path === "GTD.md") {
        return defaultFile;
      }
      if (path === "File1.md") {
        return file1;
      }
      if (path === "File2.md") {
        return file2;
      }
      // eslint-disable-next-line unicorn/no-null
      return null;
    });

    const mockVault = {
      getFileByPath,
      on: vi.fn(),
    } as unknown as Vault;

    const mockAppWithVault = {
      vault: mockVault,
    } as unknown as App;

    // Track settings to simulate persistence
    let savedSettings: Record<string, unknown> = {};
    const plugin = new ObsidianSyncerPlugin(mockAppWithVault, mockManifest);

    // Override loadData and saveData to simulate settings persistence
    plugin.loadData = vi.fn().mockImplementation(async () => savedSettings);
    plugin.saveData = vi.fn().mockImplementation(async (data) => {
      savedSettings = data as Record<string, unknown>;
    });

    await plugin.onload();

    // Clear calls made during onload (which initializes cache with default "GTD.md")
    getFileByPath.mockClear();
    vi.mocked(defaultFile.vault?.cachedRead).mockClear();
    vi.mocked(file1.vault?.cachedRead).mockClear();
    vi.mocked(file2.vault?.cachedRead).mockClear();

    // Set initial syncDocument to File1.md
    await plugin.updateSettings({ syncDocument: "File1.md" });

    // Clear calls made when setting File1.md
    getFileByPath.mockClear();
    vi.mocked(file1.vault?.cachedRead).mockClear();

    // Act: Change syncDocument to File2.md
    await plugin.updateSettings({ syncDocument: "File2.md" });

    // Assert: Cache should be initialized for File2.md
    expect(getFileByPath).toHaveBeenCalledWith("File2.md");
    expect(file2.vault?.cachedRead).toHaveBeenCalledWith(file2);
  });
});
