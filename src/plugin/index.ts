import { type App, Notice, Plugin, type PluginManifest, type TFile } from "obsidian";
import { SettingsTab } from "@/plugin/settings-tab";
import { createScheduler, type Scheduler } from "@/sync/scheduler";
import { SyncGuard } from "@/sync/sync-guard";
import { createGoogleTasksJob } from "@/jobs/google-tasks";
import type { PluginConfig, PluginSettings } from "@/plugin/types";
import { pluginSchema, pluginSettingsSchema } from "./schemas";
import { DeleteTaskConfirmationModal } from "@/plugin/modals/delete-confirmation-modal";
import { deleteGoogleTask } from "@/services/google-tasks";
import { GoogleAuth } from "@/auth";

/**
 * Syncer plugin.
 */
export default class SyncerPlugin extends Plugin {
  private scheduler: Scheduler | undefined;
  private config: PluginConfig;
  private previousFileContent = new Map<string, string>();
  private isProcessingDeletion = false;
  private readonly syncGuard = new SyncGuard();

  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    const { GOOGLE_CLIENT_ID } = pluginSchema.parse(process.env);
    this.config = {
      googleClientId: GOOGLE_CLIENT_ID,
    };
  }

  public override async onload() {
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

    // Wrap jobs so file-modification deletion detection is suppressed while syncing.
    // Without this, deselecting a list would trigger delete-confirmation modals for
    // every task the sync legitimately removed from the Markdown file.
    //
    // Two defences work together:
    //  1. syncGuard.isActive is captured synchronously in handleFileModification
    //     (before any await) so even if the modify event fires during the sync,
    //     the handler sees the guard before it can be released.
    //  2. The file-content cache is refreshed BEFORE the guard is released, so if
    //     the modify event arrives after the sync, the handler compares the
    //     current content against the post-sync cache and sees no deletions.
    const wrappedJobs = jobs.map((job) => ({
      ...job,
      task: () =>
        this.syncGuard.run(async () => {
          await job.task();
          // Update the content cache while the guard is still active so any
          // modify events that arrive after the sync compare against the
          // post-sync content and detect no deletions.
          await this.initialiseFileContentCache();
        }),
    }));

    this.scheduler = createScheduler(wrappedJobs);
    const settings = await this.loadSettings();
    this.scheduler.start(settings.syncIntervalMinutes);

    this.addCommand({
      id: "manual-sync",
      name: "Manual Sync",
      callback: async () => {
        if (this.scheduler === undefined) {
          throw new Error(
            "The Syncer plugin scheduler is not initialised. Please report this issue.",
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
  }

  /**
   * Clean-up tasks when the plugin is unloaded.
   */
  public override onunload() {
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

    // If syncDocument changed, re-initialize the cache for the new file
    if (partial.syncDocument !== undefined && partial.syncDocument !== current.syncDocument) {
      await this.initialiseFileContentCache();
    }
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
        } catch {
          // File might not be readable yet, that's okay
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

    // Capture synchronously before any awaits. The guard may be released by
    // the time async work below resumes, so we snapshot it here while we can
    // still observe the sync job's in-progress state.
    const wasSyncInProgress = this.syncGuard.isActive;

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

      // During a sync, the sync engine may legitimately remove tasks (e.g. when a
      // list is deselected). We still update the cache above so the next manual edit
      // compares against the post-sync content, but we skip deletion detection.
      if (wasSyncInProgress) {
        return;
      }

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
      return;
    }

    // Check if confirmation is required
    const shouldDeleteTaskFromGoogle =
      !settings.confirmDeleteSync || (await this.showDeleteConfirmation(deletedTask.title));
    if (!shouldDeleteTaskFromGoogle) {
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
  }
}
