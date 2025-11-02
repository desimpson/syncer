import type { PluginConfig, PluginSettings } from "@/plugin/types";
import type { SyncItem } from "@/sync/types";
import type { Vault } from "obsidian";

/**
 * Generic interface for a curried adaptor:
 *
 * @typeParam `T` - The source-specific type (e.g., `GoogleTask`)
 */
export type SyncAdaptor<T> = (heading: string) => (item: T) => SyncItem;

/**
 * Generic sync job for any integration.
 */
export type SyncJob = {
  name: string;
  task: () => Promise<void>;
};

/**
 * Simple UI-agnostic notifier for user-facing messages (e.g., warnings).
 * The plugin layer can implement this using Obsidian's `Notice`.
 *
 * @param message - The message to display to the user
 */
export type Notifier = (message: string) => void;

/**
 * A factory that produces a `SyncJob` for a specific integration.
 *
 * @param loadSettings - Fetches the freshest plugin settings from disk
 * @param saveSettings - Persists updated plugin settings
 * @param config - Integration-independent configuration
 * @param vault - Minimal interface to interact with the Obsidian vault
 * @param notify - Callback to surface user-facing messages
 * @returns A `SyncJob` that the scheduler can run
 */
export type SyncJobCreator = (
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (settings: PluginSettings) => Promise<void>,
  pluginConfig: PluginConfig,
  vault: Vault,
  notify: Notifier,
) => SyncJob;
