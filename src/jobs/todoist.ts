import { createTodoistTaskAdaptor } from "@/adaptors/todoist";
import type { SyncJobCreator } from "@/jobs/types";
import { TodoistAuth, InvalidGrantError } from "@/auth";
import type { PluginConfig, PluginSettings, TodoistSettings } from "@/plugin/types";
import { fetchTodoistTasks, updateTodoistTaskStatus } from "@/services/todoist";
import { TodoistAuthorizationError, TodoistRateLimitError } from "@/services/todoist-errors";
import type { TodoistTask } from "@/services/types";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { TODOIST_SOURCE, type SyncItem } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import { formatLogError, formatUiError } from "@/utils/error-formatters";
import type { TFile, Vault } from "obsidian";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";
import { runtimeSetTimeout } from "@/utils/browser-runtime";

const VAULT_INIT_RETRY_DELAY_MS = 500;

type CompletionChange = {
  taskId: string;
  completed: boolean;
};

class TodoistDisconnectedError extends Error {
  public constructor() {
    super("Todoist disconnected during sync");
    this.name = "TodoistDisconnectedError";
  }
}

const ensureAccessToken = async (
  todoist: TodoistSettings,
  config: PluginConfig,
  persist: (update: {
    accessToken: string;
    expiryDate: number;
    refreshToken?: string;
  }) => Promise<void>,
): Promise<string> => {
  const { credentials: token } = todoist;

  if (token.expiryDate < Date.now()) {
    const { accessToken, expiryDate, refreshToken } = await TodoistAuth.refreshAccessToken(
      config.todoistClientId,
      { refreshToken: token.refreshToken },
    );

    await persist({
      accessToken,
      expiryDate,
      ...(refreshToken === undefined ? {} : { refreshToken }),
    });
    return accessToken;
  }

  return token.accessToken;
};

const getSyncFileWithRetry = async (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<TFile | undefined> => {
  const file = vault.getFileByPath(syncDocument);
  if (file !== null) {
    return file;
  }

  await new Promise((resolve) => runtimeSetTimeout(resolve, VAULT_INIT_RETRY_DELAY_MS));
  const retryFile = vault.getFileByPath(syncDocument);

  if (retryFile === null) {
    notify(`Sync document "${syncDocument}" not found. Please update settings or create the file.`);
    console.warn(`Sync document [${syncDocument}] not found. Aborting Todoist sync.`);
    return undefined;
  }

  return retryFile;
};

type FetchedTasksByProject = { projectId: string; tasks: readonly TodoistTask[] };

/**
 * Settles per-project fetches sequentially so rate limits are easier to honour.
 * Escalates account-level 401/403 and 429; other failures yield an empty task list.
 */
const settleTasksByProject = async (
  selectedProjectIds: readonly string[],
  fetchFunction: (projectId: string) => Promise<readonly TodoistTask[]>,
): Promise<readonly FetchedTasksByProject[]> => {
  const fetched: FetchedTasksByProject[] = [];

  for (const projectId of selectedProjectIds) {
    try {
      const tasks = await fetchFunction(projectId);
      fetched.push({ projectId, tasks });
    } catch (error: unknown) {
      if (error instanceof TodoistAuthorizationError || error instanceof TodoistRateLimitError) {
        throw error;
      }

      console.warn(
        `Todoist project [${projectId}] failed; treating as empty: [${formatLogError(error)}].`,
      );
      fetched.push({ projectId, tasks: [] });
    }
  }

  return fetched;
};

const fetchAllSelectedTasks = async (
  accessToken: string,
  selectedProjectIds: readonly string[],
): Promise<readonly FetchedTasksByProject[]> =>
  settleTasksByProject(selectedProjectIds, (id) => fetchTodoistTasks(accessToken, id, false));

const detectChangeForTaskInBoth = (
  existingItem: SyncItem,
  incomingItem: SyncItem,
): CompletionChange | undefined => {
  if (existingItem.completed === incomingItem.completed) {
    return undefined;
  }

  return {
    taskId: existingItem.id,
    completed: existingItem.completed,
  };
};

const detectChangeForUncompletedTask = (existingItem: SyncItem): CompletionChange | undefined => {
  if (existingItem.completed) {
    return undefined;
  }

  return {
    taskId: existingItem.id,
    completed: false,
  };
};

const detectCompletionChanges = (
  existing: readonly SyncItem[],
  incoming: readonly SyncItem[],
): readonly CompletionChange[] => {
  const incomingMap = new Map(incoming.map((item) => [item.id, item]));

  return existing
    .map((existingItem) => {
      const incomingItem = incomingMap.get(existingItem.id);

      if (incomingItem !== undefined) {
        return detectChangeForTaskInBoth(existingItem, incomingItem);
      }

      return detectChangeForUncompletedTask(existingItem);
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
    completionChanges.map(({ taskId, completed }) =>
      updateTodoistTaskStatus(accessToken, taskId, completed),
    ),
  );

  return results.map((result, index) => ({
    result,
    change: completionChanges[index],
  }));
};

const findTodoistAuthorizationFailure = (
  updateResults: readonly UpdateResult[],
): TodoistAuthorizationError | undefined => {
  for (const item of updateResults) {
    if (
      item.result.status === "rejected" &&
      item.result.reason instanceof TodoistAuthorizationError
    ) {
      return item.result.reason;
    }
  }
  return undefined;
};

const handleFailedUpdates = (
  updateResults: readonly UpdateResult[],
  notify: (message: string) => void,
): void => {
  updateResults.forEach((item, index) => {
    if (item.change === undefined) {
      console.error(`Missing Todoist completion change at index ${index}`);
    } else if (item.result.status === "rejected") {
      console.error(
        `Failed to update completion status for Todoist task ${item.change.taskId}:`,
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

const applyCompletionChangesToTodoist = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
  notify: (message: string) => void,
): Promise<readonly CompletionChange[]> => {
  if (completionChanges.length === 0) {
    return [];
  }

  const updateResults = await executeCompletionUpdates(completionChanges, accessToken);
  const authFailure = findTodoistAuthorizationFailure(updateResults);
  if (authFailure !== undefined) {
    throw authFailure;
  }

  handleFailedUpdates(updateResults, notify);
  return extractSuccessfulChanges(updateResults);
};

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

  const updatedIncoming = incoming.map((item) => {
    const updatedCompleted = changesMap.get(item.id);
    return updatedCompleted === undefined ? item : { ...item, completed: updatedCompleted };
  });

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

const syncTasksToFile = async (
  file: TFile,
  tasksByProject: readonly { projectId: string; tasks: readonly TodoistTask[] }[],
  accessToken: string,
  syncHeading: string,
  syncDocument: string,
  syncCompletionStatus: boolean,
  notify: (message: string) => void,
) => {
  const adaptor = createTodoistTaskAdaptor(syncHeading);
  const incoming = tasksByProject.flatMap(({ tasks }) => tasks.map(adaptor));

  try {
    const existing = await readMarkdownSyncItems(file, TODOIST_SOURCE);

    let updatedIncoming: readonly SyncItem[] = incoming;
    if (syncCompletionStatus) {
      const completionChanges = detectCompletionChanges(existing, incoming);
      const successfulChanges = await applyCompletionChangesToTodoist(
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

    await reconcileSyncSourceAtomically(
      file,
      updatedIncoming,
      TODOIST_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file or directory|not found/i.test(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during Todoist sync: [${message}]. Aborting sync.`);
      return;
    }
    throw error;
  }
};

const persistRefreshedToken =
  (
    loadSettings: () => Promise<PluginSettings>,
    saveSettings: (s: PluginSettings) => Promise<void>,
  ) =>
  async ({
    accessToken,
    expiryDate,
    refreshToken,
  }: {
    accessToken: string;
    expiryDate: number;
    refreshToken?: string;
  }): Promise<void> => {
    const freshSettings = await loadSettings();
    const { todoist } = freshSettings;
    if (todoist === undefined) {
      throw new TodoistDisconnectedError();
    }

    await saveSettings({
      ...freshSettings,
      todoist: {
        ...todoist,
        credentials: {
          ...todoist.credentials,
          accessToken,
          expiryDate,
          ...(refreshToken === undefined ? {} : { refreshToken }),
        },
      },
    });
  };

const clearTodoistCredentials = async (
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  const freshSettings = await loadSettings();
  await saveSettings({ ...freshSettings, todoist: undefined });
  new AuthorizationExpiredModal(app, "Todoist").open();
};

const handleTodoistAuthorizationFailure = async (
  error: TodoistAuthorizationError,
  notify: (message: string) => void,
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  if (error.status === 401) {
    console.warn(
      `Todoist access token rejected (${error.status}). Clearing Todoist credentials...`,
    );
    await clearTodoistCredentials(loadSettings, saveSettings, app);
    return;
  }

  notify(
    "Todoist sync was denied (403). Reconnect Todoist or check that the OAuth app has data:read_write scope.",
  );
  console.warn(`Todoist access denied (${error.status}): [${error.message}]. Credentials kept.`);
};

const notifySyncFailure = (error: unknown, notify: (message: string) => void): void => {
  const message = error instanceof Error ? formatUiError(error) : formatUiError(String(error));
  notify(`Todoist sync failed: ${message}`);
};

/**
 * Create a job to sync Todoist tasks into the Markdown sync note.
 */
export const createTodoistJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
  app,
) => ({
  name: "todoist",
  task: async () => {
    const settings = await loadSettings();
    const { todoist, syncDocument, syncHeading, syncCompletionStatus } = settings;

    if (todoist === undefined) {
      return;
    }

    if (todoist.selectedProjectIds.length === 0) {
      return;
    }

    if (config.todoistClientId.length === 0) {
      return;
    }

    let currentAccessToken: string;
    try {
      currentAccessToken = await ensureAccessToken(
        todoist,
        config,
        persistRefreshedToken(loadSettings, saveSettings),
      );
    } catch (error) {
      if (error instanceof TodoistDisconnectedError) {
        return;
      }
      if (error instanceof InvalidGrantError) {
        console.warn("Todoist refresh token has been expired or revoked. Clearing credentials...");
        await clearTodoistCredentials(loadSettings, saveSettings, app);
        return;
      }
      notifySyncFailure(error, notify);
      return;
    }

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    let tasksByProject: readonly { projectId: string; tasks: readonly TodoistTask[] }[];

    try {
      tasksByProject = await fetchAllSelectedTasks(currentAccessToken, todoist.selectedProjectIds);
    } catch (error) {
      if (error instanceof TodoistAuthorizationError) {
        await handleTodoistAuthorizationFailure(error, notify, loadSettings, saveSettings, app);
        return;
      }
      if (error instanceof TodoistRateLimitError) {
        notify("Todoist sync hit a rate limit. Try again later.");
        console.warn(`Todoist rate limit: [${error.message}].`);
        return;
      }
      notifySyncFailure(error, notify);
      console.error(`Todoist sync read failed: [${formatLogError(error)}].`);
      return;
    }

    try {
      await syncTasksToFile(
        file,
        tasksByProject,
        currentAccessToken,
        syncHeading,
        syncDocument,
        syncCompletionStatus,
        notify,
      );
    } catch (error) {
      if (error instanceof TodoistAuthorizationError) {
        await handleTodoistAuthorizationFailure(error, notify, loadSettings, saveSettings, app);
        return;
      }
      if (error instanceof TodoistRateLimitError) {
        notify("Todoist sync hit a rate limit. Try again later.");
        console.warn(`Todoist rate limit: [${error.message}].`);
        return;
      }
      notifySyncFailure(error, notify);
      console.error(`Todoist sync failed: [${formatLogError(error)}].`);
    }
  },
});
