import { GoogleTasksService } from "@/services";
import { mapGoogleTaskToSyncItem } from "@/adaptors";
import type { SyncJobCreator } from "@/jobs/types";
import { generateSyncActions } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { writeSyncActions } from "@/sync/writer";
import type { PluginConfig, GoogleTasksSettings, PluginSettings } from "@/plugin/types";
import type { TFile, Vault } from "obsidian";
import type { GoogleTask } from "@/services/types";
import { GoogleAuth } from "@/auth";
import { updateGoogleTaskStatus } from "@/services/google-tasks";

const VAULT_INIT_RETRY_DELAY_MS = 500;

const ensureAccessToken = async (
  googleTasks: GoogleTasksSettings,
  config: PluginConfig,
  persist: (update: { accessToken: string; expiryDate: number }) => Promise<void>,
): Promise<string> => {
  const { credentials: token } = googleTasks;

  if (token.expiryDate < Date.now()) {
    console.info("Google Tasks token has expired. Refreshing...");
    const { accessToken, expiryDate } = await GoogleAuth.refreshAccessToken(
      config.googleClientId,
      token.refreshToken,
    );

    await persist({ accessToken, expiryDate });
    console.info("Saved refreshed Google Tasks token.");
    return accessToken;
  }

  return token.accessToken;
};

const getSyncFileWithRetry = async (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<TFile | undefined> => {
  // The initial lookup fails when Obsidian is still starting up
  const file = vault.getFileByPath(syncDocument);
  if (file !== null) {
    return file;
  }

  // Retry after a short delay in case vault is still initialising
  console.info("Sync document not found on first attempt, retrying after delay...");
  await new Promise((resolve) => setTimeout(resolve, VAULT_INIT_RETRY_DELAY_MS));
  const retryFile = vault.getFileByPath(syncDocument);

  if (retryFile === null) {
    notify(`Sync document "${syncDocument}" not found. Please update settings or create the file.`);
    console.warn(`Sync document [${syncDocument}] not found. Aborting sync.`);
    return undefined;
  }

  return retryFile;
};

const fetchAllSelectedTasks = async (
  accessToken: string,
  selectedListIds: readonly string[],
): Promise<{ tasks: readonly GoogleTask[]; taskIdToListIdMap: Map<string, string> }> => {
  const fetchTasks = GoogleTasksService.createGoogleTasksFetcher(accessToken);
  const fetchedTasksByList = await Promise.all(
    selectedListIds.map(async (listId) => {
      const tasks = await fetchTasks(listId);
      return { listId, tasks };
    }),
  );

  const taskIdToListIdMap = new Map<string, string>();
  fetchedTasksByList.forEach(({ listId, tasks }) => {
    tasks.forEach((task) => {
      taskIdToListIdMap.set(task.id, listId);
    });
  });

  const allTasks = fetchedTasksByList.flatMap(({ tasks }) => tasks);
  return { tasks: allTasks, taskIdToListIdMap };
};

const syncTasksToFile = async (
  file: TFile,
  tasks: readonly GoogleTask[],
  taskIdToListIdMap: Map<string, string>,
  accessToken: string,
  syncHeading: string,
  syncDocument: string,
  notify: (message: string) => void,
) => {
  const adaptor = mapGoogleTaskToSyncItem(syncHeading);
  const incoming = tasks.map(adaptor);
  console.info(`Mapped incoming Google Tasks to sync items: [${incoming.length}] items.`);

  try {
    const existing = await readMarkdownSyncItems(file, "google-tasks");
    console.info(`Read existing Google Tasks Markdown items: [${existing.length}] items.`);

    // Detect completion changes: if an existing item has a different completion status
    // than the incoming item, we should update Google Tasks
    const completionChanges: { taskId: string; listId: string; completed: boolean }[] = [];

    existing.forEach((existingItem) => {
      const incomingItem = incoming.find((item) => item.id === existingItem.id);
      if (incomingItem !== undefined) {
        const existingCompleted = existingItem.completed ?? false;
        const incomingCompleted = incomingItem.completed ?? false;

        // If completion status differs, mark for update
        // Existing (Obsidian) takes precedence over incoming (Google Tasks)
        if (existingCompleted !== incomingCompleted) {
          const listId = taskIdToListIdMap.get(existingItem.id);
          if (listId !== undefined) {
            completionChanges.push({
              taskId: existingItem.id,
              listId,
              completed: existingCompleted,
            });
          }
        }
      }
    });

    // Update Google Tasks for completion changes
    if (completionChanges.length > 0) {
      console.info(
        `Detected [${completionChanges.length}] completion status changes. Syncing to Google Tasks...`,
      );
      await Promise.all(
        completionChanges.map(({ taskId, listId, completed }) =>
          updateGoogleTaskStatus(accessToken, listId, taskId, completed).catch((error) => {
            console.error(
              `Failed to update completion status for task ${taskId} in list ${listId}:`,
              error,
            );
            notify(`Failed to sync completion status for task: ${taskId}`);
          }),
        ),
      );
      console.info(
        `Synced [${completionChanges.length}] completion status changes to Google Tasks.`,
      );

      // After updating Google Tasks, we should update the incoming items to reflect the changes
      // This ensures the file sync uses the updated status
      completionChanges.forEach(({ taskId, completed }) => {
        const item = incoming.find((incomingItem) => incomingItem.id === taskId);
        if (item !== undefined) {
          item.completed = completed;
        }
      });
    }

    const actions = generateSyncActions(incoming, existing);
    console.info(`Generated [${actions.length}] sync actions.`);

    await writeSyncActions(file, actions, syncHeading);
    console.info(`Applied [${actions.length}] Google Tasks sync actions to the Markdown note.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file or directory|not found/i.test(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during sync: [${message}]. Aborting sync.`);
      return;
    }
    throw error;
  }
};

/**
 * Create a job to sync Google Tasks into a Markdown note.
 *
 * @param loadSettings - Function that returns the current plugin settings
 * @param saveSettings - Function to persist updated plugin settings to storage,
 *                       accepting a `PluginSettings` object
 * @param config - The plugin configuration
 * @param vault - A `Vault`-like object to access files
 * @param notify - Function to display user-facing messages
 * @returns A `SyncJob` that can be scheduled
 */
export const createGoogleTasksJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
) => ({
  name: "google-tasks",
  task: async () => {
    console.info("Starting Google Tasks sync job...");

    // TODO: Test settings freshness?
    const settings = await loadSettings();
    const { googleTasks, syncDocument, syncHeading } = settings;
    if (googleTasks === undefined) {
      console.info("No Google Tasks configured.");
      return;
    }

    if (googleTasks.selectedListIds.length === 0) {
      console.info("No Google Tasks lists selected.");
      return;
    }

    const currentAccessToken = await ensureAccessToken(
      googleTasks,
      config,
      async ({ accessToken, expiryDate }) => {
        const updatedSettings: PluginSettings = {
          ...settings,
          googleTasks: {
            ...googleTasks,
            credentials: { ...googleTasks.credentials, accessToken, expiryDate },
          },
        };
        console.info("Updated Google Tasks token in memory.");
        await saveSettings(updatedSettings);
      },
    );

    // Read the Markdown file with retry for Obsidian startup timing
    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    // Fetch tasks from Google Tasks
    const { tasks, taskIdToListIdMap } = await fetchAllSelectedTasks(
      currentAccessToken,
      googleTasks.selectedListIds,
    );
    console.info(`Fetched [${tasks.length}] tasks from Google Tasks.`);

    // Convert and sync
    await syncTasksToFile(
      file,
      tasks,
      taskIdToListIdMap,
      currentAccessToken,
      syncHeading,
      syncDocument,
      notify,
    );
  },
});
