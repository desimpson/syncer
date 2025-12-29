import { GoogleTasksService } from "@/services";
import { mapGoogleTaskToSyncItem } from "@/adaptors";
import type { SyncJobCreator } from "@/jobs/types";
import { generateSyncActions } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { writeSyncActions } from "@/sync/writer";
import type { PluginConfig, GoogleTasksSettings, PluginSettings } from "@/plugin/types";
import type { App, TFile, Vault } from "obsidian";
import type { GoogleTask } from "@/services/types";
import { GoogleAuth, InvalidGrantError } from "@/auth";
import { fetchGoogleTasks, updateGoogleTaskStatus } from "@/services/google-tasks";
import type { SyncAction, SyncItem } from "@/sync/types";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";

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
  const entries = fetchedTasksByList.flatMap(({ listId, tasks }) =>
    tasks.map((task) => [task.id, listId] as const),
  );
  return new Map(entries);
};

const fetchTasksForList = async (
  listId: string,
  fetchFunction: (listId: string) => Promise<readonly GoogleTask[]>,
): Promise<{ listId: string; tasks: readonly GoogleTask[] }> => {
  const tasks = await fetchFunction(listId);
  return { listId, tasks };
};

const fetchAllSelectedTasks = async (
  accessToken: string,
  selectedListIds: readonly string[],
): Promise<{ tasks: readonly GoogleTask[]; taskIdToListIdMap: Map<string, string> }> => {
  const fetchTasks = GoogleTasksService.createGoogleTasksFetcher(accessToken);

  // Fetch incomplete tasks (for incoming list - only these are written to Markdown)
  const fetchedTasksByList = await Promise.all(
    selectedListIds.map((listId) => fetchTasksForList(listId, fetchTasks)),
  );

  // Also fetch completed tasks to build a complete taskIdToListIdMap
  // This allows us to detect when tasks need to be uncompleted in Google
  const fetchedCompletedTasksByList = await Promise.all(
    selectedListIds.map((listId) =>
      fetchTasksForList(listId, (id) => fetchGoogleTasks(accessToken, id, true)),
    ),
  );

  // Build map from both incomplete and completed tasks
  const allFetchedTasksByList = [...fetchedTasksByList, ...fetchedCompletedTasksByList];
  const taskIdToListIdMap = buildTaskIdToListIdMap(allFetchedTasksByList);

  // Only return incomplete tasks for the incoming list (these are written to Markdown)
  const allTasks = fetchedTasksByList.flatMap(({ tasks }) => tasks);
  return { tasks: allTasks, taskIdToListIdMap };
};

const detectChangeForTaskInBoth = (
  existingItem: SyncItem,
  incomingItem: SyncItem,
  listId: string | undefined,
): CompletionChange | undefined => {
  if (existingItem.completed === incomingItem.completed || listId === undefined) {
    return undefined;
  }

  return {
    taskId: existingItem.id,
    listId,
    completed: existingItem.completed,
  };
};

const detectChangeForUncompletedTask = (
  existingItem: SyncItem,
  listId: string | undefined,
): CompletionChange | undefined => {
  if (existingItem.completed || listId === undefined) {
    return undefined;
  }

  return {
    taskId: existingItem.id,
    listId,
    completed: false, // Uncomplete in Google
  };
};

/**
 * Detect completion status changes for tasks in Obsidian.
 *
 * Detects changes in two scenarios:
 * 1. Tasks that exist in both Obsidian and incoming (incomplete tasks from Google)
 * 2. Tasks that are incomplete in Obsidian but not in incoming (completed in Google, need to uncomplete)
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
      const listId = taskIdToListIdMap.get(existingItem.id);

      if (incomingItem !== undefined) {
        return detectChangeForTaskInBoth(existingItem, incomingItem, listId);
      }

      return detectChangeForUncompletedTask(existingItem, listId);
    })
    .filter((change): change is CompletionChange => change !== undefined);
};

type UpdateResult = {
  result: PromiseSettledResult<void>;
  change: CompletionChange | undefined;
};

const executeCompletionUpdates = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
): Promise<readonly UpdateResult[]> => {
  const results = await Promise.allSettled(
    completionChanges.map(({ taskId, listId, completed }) =>
      updateGoogleTaskStatus(accessToken, listId, taskId, completed),
    ),
  );

  return results.map((result, index) => ({
    result,
    change: completionChanges[index],
  }));
};

const handleFailedUpdates = (
  updateResults: readonly UpdateResult[],
  notify: (message: string) => void,
): void => {
  updateResults.forEach((item, index) => {
    if (item.change === undefined) {
      console.error(`Missing completion change at index ${index}`);
    } else if (item.result.status === "rejected") {
      console.error(
        `Failed to update completion status for task ${item.change.taskId} in list ${item.change.listId}:`,
        item.result.reason,
      );
      notify(`Failed to sync completion status for task: ${item.change.taskId}`);
    }
  });
};

const extractSuccessfulChanges = (
  updateResults: readonly UpdateResult[],
): readonly CompletionChange[] =>
  updateResults
    .filter(
      (item): item is { result: PromiseFulfilledResult<void>; change: CompletionChange } =>
        item.result.status === "fulfilled" && item.change !== undefined,
    )
    .map(({ change }) => change);

/**
 * Apply completion status changes detected from Obsidian to Google Tasks.
 *
 * This only runs for tasks that are still present in the incoming Google
 * data; completed Google Tasks that have dropped out of the feed are
 * intentionally unaffected. Completing a task directly in Google therefore
 * causes it to disappear from the incoming list and, on the next sync, its
 * corresponding line will be removed from the Obsidian note by the normal
 * create/update/delete reconciliation.
 *
 * @returns An array of completion changes that were successfully applied to Google Tasks
 */
const applyCompletionChangesToGoogleTasks = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
  notify: (message: string) => void,
): Promise<readonly CompletionChange[]> => {
  if (completionChanges.length === 0) {
    return [];
  }

  console.info(
    `Detected [${completionChanges.length}] completion status changes. Syncing to Google Tasks...`,
  );

  const updateResults = await executeCompletionUpdates(completionChanges, accessToken);
  handleFailedUpdates(updateResults, notify);
  const successfulChanges = extractSuccessfulChanges(updateResults);

  console.info(
    `Synced [${successfulChanges.length}] of [${completionChanges.length}] completion status changes to Google Tasks.`,
  );

  return successfulChanges;
};

/**
 * Update the incoming items with any completion changes pushed to Google.
 *
 * This keeps the in-memory representation used for Markdown sync consistent
 * with what we just wrote back to Google. Also adds uncompleted tasks to the
 * incoming list (since they weren't there before but now exist in Google as incomplete).
 */
const updateIncomingItemsWithCompletionChanges = (
  incoming: readonly SyncItem[],
  completionChanges: readonly CompletionChange[],
  existing: readonly SyncItem[],
): readonly SyncItem[] => {
  if (completionChanges.length === 0) {
    return incoming;
  }

  const changesMap = new Map(completionChanges.map((change) => [change.taskId, change.completed]));
  const incomingIds = new Set(incoming.map((item) => item.id));

  // Update existing incoming items with completion changes
  const updatedIncoming = incoming.map((item) => {
    const updatedCompleted = changesMap.get(item.id);
    return updatedCompleted === undefined ? item : { ...item, completed: updatedCompleted };
  });

  // Add uncompleted tasks that weren't in incoming (they were completed in Google)
  const existingMap = new Map(existing.map((item) => [item.id, item]));
  const uncompletedTasks = completionChanges
    .filter((change) => !change.completed && !incomingIds.has(change.taskId))
    .map((change) => {
      const existingItem = existingMap.get(change.taskId);
      return existingItem === undefined ? undefined : { ...existingItem, completed: false };
    })
    .filter((item): item is SyncItem => item !== undefined);

  return [...updatedIncoming, ...uncompletedTasks];
};

const shouldPreserveTask = (action: SyncAction): boolean =>
  action.operation !== "delete" || !action.item.completed;

const syncTasksToFile = async (
  file: TFile,
  tasks: readonly GoogleTask[],
  taskIdToListIdMap: Map<string, string>,
  accessToken: string,
  syncHeading: string,
  syncDocument: string,
  syncCompletionStatus: boolean,
  notify: (message: string) => void,
) => {
  const adaptor = mapGoogleTaskToSyncItem(syncHeading);
  const incoming = tasks.map(adaptor);
  console.info(`Mapped incoming Google Tasks to sync items: [${incoming.length}] items.`);

  try {
    const existing = await readMarkdownSyncItems(file, "google-tasks");
    console.info(`Read existing Google Tasks Markdown items: [${existing.length}] items.`);

    let updatedIncoming: readonly SyncItem[] = incoming;
    if (syncCompletionStatus) {
      const completionChanges = detectCompletionChanges(existing, incoming, taskIdToListIdMap);
      const successfulChanges = await applyCompletionChangesToGoogleTasks(
        completionChanges,
        accessToken,
        notify,
      );

      updatedIncoming = updateIncomingItemsWithCompletionChanges(
        incoming,
        successfulChanges,
        existing,
      );
    }

    const allActions = generateSyncActions(updatedIncoming, existing);
    // Preserve completed tasks in Obsidian
    const actions = allActions.filter(shouldPreserveTask);
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
  // App type is inferred from SyncJobCreator, but we need it in scope for the parameter
  app: App,
) => ({
  name: "google-tasks",
  task: async () => {
    console.info("Starting Google Tasks sync job...");

    // TODO: Test settings freshness?
    const settings = await loadSettings();
    const { googleTasks, syncDocument, syncHeading, syncCompletionStatus } = settings;
    if (googleTasks === undefined) {
      console.info("No Google Tasks configured.");
      return;
    }

    if (googleTasks.selectedListIds.length === 0) {
      console.info("No Google Tasks lists selected.");
      return;
    }

    let currentAccessToken: string;
    try {
      currentAccessToken = await ensureAccessToken(
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
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        console.warn(
          "Google Tasks refresh token has been expired or revoked. Clearing credentials...",
        );
        const freshSettings = await loadSettings();
        await saveSettings({ ...freshSettings, googleTasks: undefined });
        new AuthorizationExpiredModal(app).open();
        return;
      }
      throw error;
    }

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
      syncCompletionStatus,
      notify,
    );
  },
});
