import { type App, Notice, Plugin, type PluginManifest, type TFile } from "obsidian";
import { SettingsTab } from "@/plugin/settings-tab";
import { createScheduler, type Scheduler } from "@/sync/scheduler";
import { createGoogleTasksJob } from "@/jobs/google-tasks";
import type { PluginConfig, PluginSettings } from "@/plugin/types";
import { pluginSchema, pluginSettingsSchema } from "./schemas";
import { DeleteTaskConfirmationModal } from "@/plugin/modals/delete-confirmation-modal";
import { deleteGoogleTask } from "@/services/google-tasks";
import { GoogleAuth } from "@/auth";

/**
 * Obsidian Syncer plugin.
 */
export default class ObsidianSyncerPlugin extends Plugin {
  private scheduler: Scheduler | undefined;
  private config: PluginConfig;
  private previousFileContent = new Map<string, string>();
  private isProcessingDeletion = false;

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    const { GOOGLE_CLIENT_ID } = pluginSchema.parse(process.env);
    this.config = {
      googleClientId: GOOGLE_CLIENT_ID,
    };
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
        this.app,
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

    // Initialise previous file content for deletion detection
    await this.initialiseFileContentCache();

    // Set up file modification listener for task deletion detection
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        // Only process files, not folders - getFileByPath returns TFile | null
        const fileToProcess = this.app.vault.getFileByPath(file.path);
        if (fileToProcess !== null) {
          await this.handleFileModification(fileToProcess);
        }
      }),
    );

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

  /**
   * Initialises the file content cache with current content.
   */
  private async initialiseFileContentCache(): Promise<void> {
    try {
      const settings = await this.loadSettings();
      const file = this.app.vault.getFileByPath(settings.syncDocument);
      if (file !== null) {
        try {
          const content = await file.vault.cachedRead(file);
          this.previousFileContent.set(file.path, content);
        } catch (error) {
          // File might not be readable yet, that's okay
          console.debug("Could not read file for content cache initialization:", error);
        }
      }
    } catch (error) {
      console.warn("Failed to initialise file content cache:", error);
    }
  }

  /**
   * Handles file modifications to detect task deletions.
   */
  private async handleFileModification(file: TFile): Promise<void> {
    // Skip if we're already processing a deletion to avoid infinite loops
    if (this.isProcessingDeletion) {
      return;
    }

    const settings = await this.loadSettings();
    const { syncDocument, googleTasks, enableDeleteSync } = settings;

    // Only process the sync document
    if (file.path !== syncDocument || googleTasks === undefined || !enableDeleteSync) {
      return;
    }

    try {
      const currentContent = await file.vault.cachedRead(file);
      const previousContent = this.previousFileContent.get(file.path);

      // Store current content for next comparison
      this.previousFileContent.set(file.path, currentContent);

      // If we don't have previous content, this is the first time we're seeing this file
      if (previousContent === undefined) {
        return;
      }

      // Parse tasks from previous and current content
      const previousTasks = await this.parseTasksFromContent(previousContent, file);
      const currentTasks = await this.parseTasksFromContent(currentContent, file);

      // Find deleted tasks (present in previous but not in current)
      const currentTaskIds = new Set(currentTasks.map((task) => task.id));
      const deletedTasks = previousTasks.filter((task) => !currentTaskIds.has(task.id));

      // Only process Google Tasks deletions
      const deletedGoogleTasks = deletedTasks.filter((task) => task.source === "google-tasks");

      if (deletedGoogleTasks.length === 0) {
        return;
      }

      // Process deleted tasks sequentially
      // Check if each task still exists in Google Tasks
      // If it exists, prompt for confirmation; if not, it was sync-initiated so skip
      await deletedGoogleTasks.reduce(async (previousPromise, deletedTask) => {
        await previousPromise;
        await this.processDeletedTask(deletedTask, googleTasks, settings);
      }, Promise.resolve());
    } catch (error) {
      console.error("Error handling file modification:", error);
    }
  }

  /**
   * Parses tasks from file content.
   */
  private async parseTasksFromContent(
    content: string,
    _file: TFile,
  ): Promise<readonly { id: string; title: string; source: string }[]> {
    // Create a temporary file-like object to use with readMarkdownSyncItems
    // We'll parse manually instead since we need to work with content strings
    const lines = content.split("\n");
    const metadataRegex = /<!--\s*({[\s\S]*?})\s*-->/;

    return lines
      .map((line) => {
        const match = line.match(metadataRegex);
        if (match === null || match[1] === undefined) {
          return undefined;
        }

        try {
          const metadata = JSON.parse(match[1]);
          return {
            id: metadata.id,
            title: metadata.title,
            source: metadata.source,
          };
        } catch {
          return undefined;
        }
      })
      .filter((task): task is { id: string; title: string; source: string } => task !== undefined);
  }

  /**
   * Processes a deleted task: checks if it exists in Google Tasks and prompts for deletion if needed.
   */
  private async processDeletedTask(
    deletedTask: { id: string; title: string },
    googleTasks: PluginSettings["googleTasks"],
    settings: PluginSettings,
  ): Promise<void> {
    const taskStillExists = await this.checkTaskExistsInGoogle(deletedTask.id, googleTasks);
    if (!taskStillExists) {
      console.debug(
        `Task ${deletedTask.id} was already deleted in Google Tasks (sync-initiated), skipping deletion prompt`,
      );
      return;
    }

    // Check if confirmation is required
    const shouldDeleteTaskFromGoogle =
      !settings.confirmDeleteSync || (await this.showDeleteConfirmation(deletedTask.title));
    if (!shouldDeleteTaskFromGoogle) {
      console.debug(`User cancelled deletion of task ${deletedTask.id} from Google Tasks`);
      // Track this task as manually deleted so it doesn't get re-added on next sync
      await this.trackManuallyDeletedTask(deletedTask.id, settings);
      return;
    }

    await this.deleteTaskFromGoogle(deletedTask.id, googleTasks, settings);
  }

  /**
   * Shows a confirmation modal for task deletion.
   */
  private async showDeleteConfirmation(taskTitle: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new DeleteTaskConfirmationModal(this.app, taskTitle);
      modal.open();
      return modal.waitForConfirmation().then(resolve);
    });
  }

  /**
   * Checks if a task still exists in Google Tasks.
   * Returns true if the task exists, false if it doesn't (was already deleted).
   */
  private async checkTaskExistsInGoogle(
    taskId: string,
    googleTasks: PluginSettings["googleTasks"],
  ): Promise<boolean> {
    if (googleTasks === undefined) {
      return false;
    }

    try {
      // Ensure we have a valid access token
      const { credentials: token } = googleTasks;
      let accessToken = token.accessToken;

      if (token.expiryDate < Date.now()) {
        console.info("Google Tasks token has expired. Refreshing...");
        const refreshed = await GoogleAuth.refreshAccessToken(
          this.config.googleClientId,
          token.refreshToken,
        );
        accessToken = refreshed.accessToken;

        // Update settings with new token
        await this.updateSettings({
          googleTasks: {
            ...googleTasks,
            credentials: { ...token, accessToken, expiryDate: refreshed.expiryDate },
          },
        });
      }

      // Check if task exists in any of the available lists
      // We search all available lists, not just selected ones, because tasks
      // from previously selected lists may still exist in the note
      const { fetchGoogleTasks } = await import("@/services/google-tasks");

      // Fallback to selectedListIds if availableLists is empty (backward compatibility)
      const listsToSearch =
        googleTasks.availableLists.length > 0
          ? googleTasks.availableLists.map((list) => list.id)
          : googleTasks.selectedListIds;

      for (const listId of listsToSearch) {
        const tasks = await fetchGoogleTasks(accessToken, listId, true); // Include completed tasks
        const task = tasks.find((t) => t.id === taskId);
        if (task !== undefined) {
          return true; // Task exists
        }
      }

      return false; // Task not found in any list
    } catch (error) {
      console.error("Failed to check if task exists in Google Tasks:", error);
      // If we can't check, assume it exists to be safe (will prompt user)
      return true;
    }
  }

  /**
   * Deletes a task from Google Tasks.
   */
  private async deleteTaskFromGoogle(
    taskId: string,
    googleTasks: PluginSettings["googleTasks"],
    _settings: PluginSettings,
  ): Promise<void> {
    if (googleTasks === undefined) {
      return;
    }

    try {
      this.isProcessingDeletion = true;

      // Ensure we have a valid access token
      const { credentials: token } = googleTasks;
      let accessToken = token.accessToken;

      if (token.expiryDate < Date.now()) {
        console.info("Google Tasks token has expired. Refreshing...");
        const refreshed = await GoogleAuth.refreshAccessToken(
          this.config.googleClientId,
          token.refreshToken,
        );
        accessToken = refreshed.accessToken;

        // Update settings with new token
        await this.updateSettings({
          googleTasks: {
            ...googleTasks,
            credentials: { ...token, accessToken, expiryDate: refreshed.expiryDate },
          },
        });
      }

      // Find which list contains this task
      // We search all available lists, not just selected ones, because tasks
      // from previously selected lists may still exist in the note
      const { fetchGoogleTasks } = await import("@/services/google-tasks");
      let listId: string | undefined;

      // Fallback to selectedListIds if availableLists is empty (backward compatibility)
      const listsToSearch =
        googleTasks.availableLists.length > 0
          ? googleTasks.availableLists.map((list) => list.id)
          : googleTasks.selectedListIds;

      for (const searchListId of listsToSearch) {
        const tasks = await fetchGoogleTasks(accessToken, searchListId, true); // Include completed tasks
        const task = tasks.find((t) => t.id === taskId);
        if (task !== undefined) {
          listId = searchListId;
          break;
        }
      }

      if (listId === undefined) {
        new Notice(`Could not find task list for task: ${taskId}`);
        console.warn(`Could not find task list for task: ${taskId}`);
        return;
      }

      // Delete the task
      await deleteGoogleTask(accessToken, listId, taskId);
      new Notice(`Task deleted from Google Tasks`);
      console.info(`Deleted task ${taskId} from Google Tasks list ${listId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to delete task from Google Tasks: ${message}`);
      console.error("Failed to delete task from Google Tasks:", error);
    } finally {
      this.isProcessingDeletion = false;
    }
  }

  /**
   * Tracks a task as manually deleted in Obsidian (when user cancels deletion in Google Tasks).
   * This prevents the task from being re-added on the next sync.
   */
  private async trackManuallyDeletedTask(taskId: string, _settings: PluginSettings): Promise<void> {
    // Reload settings to get the latest manuallyDeletedTaskIds, as settings may be stale
    // when multiple tasks are deleted sequentially
    const currentSettings = await this.loadSettings();
    if (currentSettings.manuallyDeletedTaskIds.includes(taskId)) {
      return;
    }

    const updatedIds = [...currentSettings.manuallyDeletedTaskIds, taskId];
    await this.updateSettings({ manuallyDeletedTaskIds: updatedIds });
    console.debug(`Tracked task ${taskId} as manually deleted to prevent re-sync`);
  }
}
