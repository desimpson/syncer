import { type App, Notice, Plugin, type PluginManifest } from "obsidian";
import { SettingsTab } from "@/plugin/settings-tab";
import { createScheduler, type Scheduler } from "@/sync/scheduler";
import { createGoogleTasksJob } from "@/integrations/google-tasks/job";
import type { PluginConfig, PluginSettings } from "@/plugin/types";
import { pluginSchema, pluginSettingsSchema } from "./schemas";

/**
 * Obsidian Syncer plugin.
 */
export default class ObsidianSyncerPlugin extends Plugin {
  private scheduler: Scheduler | undefined;
  private config: PluginConfig;

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = pluginSchema.parse(process.env);
    this.config = { googleClientId: GOOGLE_CLIENT_ID, googleClientSecret: GOOGLE_CLIENT_SECRET };
    console.info(`Initialising [${manifest.name}] plugin...`);
  }

  public override async onload() {
    console.info(`Loading [${this.manifest.name}] plugin...`);

    const jobs = [
      createGoogleTasksJob(
        this.loadSettings,
        this.saveSettings,
        this.config,
        this.app.vault,
        (message) => new Notice(message),
      ),
    ];
    console.info(`Initialised [${jobs.length}] sync jobs.`);

    this.scheduler = createScheduler(jobs);
    const settings = await this.loadSettings();
    console.info("Starting sync scheduler...");
    this.scheduler.start(settings.syncIntervalMinutes);
    console.info("Sync scheduler started.");

    this.addCommand({
      id: "manual-sync",
      name: "Manual Sync",
      callback: async () => {
        if (this.scheduler === undefined) {
          throw new Error(
            "The Obsidian Syncer plugin scheduler is not initialised. Please report this issue.",
          );
        }

        new Notice("Starting manual sync...");
        const { syncIntervalMinutes } = await this.loadSettings();
        this.scheduler.restart(syncIntervalMinutes);
        new Notice("Manual sync completed.");
      },
    });

    this.addSettingTab(new SettingsTab(this.app, this, this.config));

    console.info(`[${this.manifest.name}] plugin loaded.`);
  }

  /**
   * Clean-up tasks when the plugin is unloaded.
   */
  public override onunload() {
    console.info(`Unloading [${this.manifest.name}] plugin...`);

    if (this.scheduler !== undefined) {
      this.scheduler.stop();
    }

    // TODO: Other cleanup tasks?
  }

  /**
   * Loads the plugin settings, applying defaults for certain fields if not set.
   *
   * @returns A promise that resolves to the plugin settings
   */
  public loadSettings = async (): Promise<PluginSettings> => {
    const raw = (await this.loadData()) ?? {};
    const parsed = pluginSettingsSchema.parse(raw);
    return parsed satisfies PluginSettings;
  };

  /**
   * Saves the plugin settings to disk.
   *
   * @param settings - The settings to save
   */
  public saveSettings = async (settings: PluginSettings): Promise<void> => {
    await this.saveData(settings);
  };

  /**
   * Updates the plugin settings on disk.
   *
   * @param partial - Partial settings to update
   */
  public updateSettings = async (partial: Partial<PluginSettings>): Promise<void> => {
    const current = await this.loadSettings();
    const updated = { ...current, ...partial };
    await this.saveSettings(updated);
  };
}
