import { describe, it, expect, beforeEach } from "vitest";
import ObsidianSyncerPlugin from "@/plugin";
import type { App, PluginManifest } from "obsidian";

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
