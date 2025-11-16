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
import type { SyncItem } from "@/sync/types";

const VAULT_INIT_RETRY_DELAY_MS = 500;

type CompletionChange = {
  taskId: string;
  listId: string;
  completed: boolean;
};

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

const buildTaskIdToListIdMap = (
  fetchedTasksByList: readonly { listId: string; tasks: readonly GoogleTask[] }[],
): Map<string, string> => {
  const map = new Map<string, string>();
  fetchedTasksByList.forEach(({ listId, tasks }) => {
    tasks.forEach((task) => {
      map.set(task.id, listId);
    });
  });
  return map;
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

  const taskIdToListIdMap = buildTaskIdToListIdMap(fetchedTasksByList);
  const allTasks = fetchedTasksByList.flatMap(({ tasks }) => tasks);
  return { tasks: allTasks, taskIdToListIdMap };
};

/**
 * Detect completion status changes for tasks that exist in both Obsidian and
 * the incoming Google Tasks list.
 *
 * Because completed Google Tasks are not fetched/synced at all, this
 * function will never see tasks that have already been completed only on the
 * Google side. In practice this means:
 *
 * - If a task is completed in Obsidian, we push that completion state to
 *   Google Tasks (for tasks that are still incomplete there).
 * - If a task is completed in Google and disappears from the incoming list,
 *   we do *not* resurrect or modify it from Obsidian; instead, the normal
 *   create/update/delete reconciliation will remove its line from the
 *   target Markdown document, regardless of which heading it appears under,
 *   on the next sync.
 */
const detectCompletionChanges = (
  existing: readonly SyncItem[],
  incoming: readonly SyncItem[],
  taskIdToListIdMap: Map<string, string>,
): readonly CompletionChange[] => {
  const incomingMap = new Map(incoming.map((item) => [item.id, item]));

  return existing
    .map((existingItem) => {
      const incomingItem = incomingMap.get(existingItem.id);
      if (incomingItem === undefined) {
        return undefined;
      }

      const existingCompleted = existingItem.completed;
      const incomingCompleted = incomingItem.completed;

      if (existingCompleted === incomingCompleted) {
        return undefined;
      }

      const listId = taskIdToListIdMap.get(existingItem.id);
      if (listId === undefined) {
        return undefined;
      }

      return {
        taskId: existingItem.id,
        listId,
        completed: existingCompleted,
      };
    })
    .filter((change): change is CompletionChange => change !== undefined);
};

/**
 * Apply completion status changes detected from Obsidian to Google Tasks.
 *
 * This only runs for tasks that are still present in the incoming Google
 * data; completed Google Tasks that have dropped out of the feed are
 * intentionally unaffected. Completing a task directly in Google therefore
 * causes it to disappear from the incoming list and, on the next sync, its
 * corresponding line will be removed from the Obsidian note by the normal
 * create/update/delete reconciliation.
 */
const applyCompletionChangesToGoogleTasks = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
  notify: (message: string) => void,
): Promise<void> => {
  if (completionChanges.length === 0) {
    return;
  }

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

  console.info(`Synced [${completionChanges.length}] completion status changes to Google Tasks.`);
};

/**
 * Update the incoming items with any completion changes pushed to Google.
 *
 * This keeps the in-memory representation used for Markdown sync consistent
 * with what we just wrote back to Google.
 */
const updateIncomingItemsWithCompletionChanges = (
  incoming: readonly SyncItem[],
  completionChanges: readonly CompletionChange[],
): readonly SyncItem[] => {
  if (completionChanges.length === 0) {
    return incoming;
  }

  const changesMap = new Map(completionChanges.map((change) => [change.taskId, change.completed]));

  return incoming.map((item) => {
    const updatedCompleted = changesMap.get(item.id);
    return updatedCompleted === undefined ? item : { ...item, completed: updatedCompleted };
  });
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

    const completionChanges = detectCompletionChanges(existing, incoming, taskIdToListIdMap);
    await applyCompletionChangesToGoogleTasks(completionChanges, accessToken, notify);

    const updatedIncoming = updateIncomingItemsWithCompletionChanges(incoming, completionChanges);
    const actions = generateSyncActions(updatedIncoming, existing);
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
