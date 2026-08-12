import { createMicrosoftToDoTaskAdaptor } from "@/adaptors/microsoft-todo";
import type { SyncJobCreator } from "@/jobs/types";
import { MicrosoftAuth, InvalidGrantError } from "@/auth";
import type { MicrosoftToDoSettings, PluginConfig, PluginSettings } from "@/plugin/types";
import { fetchMicrosoftToDoTasks, updateMicrosoftToDoTaskStatus } from "@/services/microsoft-todo";
import { GraphAuthorizationError, GraphRateLimitError } from "@/services/microsoft-graph-errors";
import type { MicrosoftToDoTask } from "@/services/types";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { MICROSOFT_TO_DO_SOURCE, type SyncItem } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import { formatLogError, formatUiError } from "@/utils/error-formatters";
import type { TFile, Vault } from "obsidian";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";
import { runtimeSetTimeout } from "@/utils/browser-runtime";

const VAULT_INIT_RETRY_DELAY_MS = 500;

type CompletionChange = {
  taskId: string;
  listId: string;
  completed: boolean;
};

class MicrosoftToDoDisconnectedError extends Error {
  public constructor() {
    super("Microsoft To Do disconnected during sync");
    this.name = "MicrosoftToDoDisconnectedError";
  }
}

const ensureAccessToken = async (
  microsoftToDo: MicrosoftToDoSettings,
  config: PluginConfig,
  persist: (update: {
    accessToken: string;
    expiryDate: number;
    refreshToken?: string;
  }) => Promise<void>,
): Promise<string> => {
  const { credentials: token } = microsoftToDo;

  if (token.expiryDate < Date.now()) {
    const { accessToken, expiryDate, refreshToken } = await MicrosoftAuth.refreshAccessToken(
      config.microsoftClientId,
      {
        refreshToken: token.refreshToken,
        tenantSegment: token.tenantSegment,
      },
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
    console.warn(`Sync document [${syncDocument}] not found. Aborting Microsoft To Do sync.`);
    return undefined;
  }

  return retryFile;
};

const buildTaskIdToListIdMap = (
  fetchedTasksByList: readonly { listId: string; tasks: readonly MicrosoftToDoTask[] }[],
): Map<string, string> => {
  const entries = fetchedTasksByList.flatMap(({ listId, tasks }) =>
    tasks.map((task) => [task.id, listId] as const),
  );
  return new Map(entries);
};

const fetchTasksForList = async (
  listId: string,
  fetchFunction: (listId: string) => Promise<readonly MicrosoftToDoTask[]>,
): Promise<{ listId: string; tasks: readonly MicrosoftToDoTask[] }> => {
  const tasks = await fetchFunction(listId);
  return { listId, tasks };
};

type FetchedTasksByList = { listId: string; tasks: readonly MicrosoftToDoTask[] };

/**
 * Settles per-list fetches so one deleted/inaccessible list does not abort the run.
 * Escalates account-level 401/403 and 429; other failures yield an empty task list.
 */
const settleTasksByList = async (
  selectedListIds: readonly string[],
  fetchFunction: (listId: string) => Promise<readonly MicrosoftToDoTask[]>,
): Promise<readonly FetchedTasksByList[]> => {
  const settled = await Promise.allSettled(
    selectedListIds.map((listId) => fetchTasksForList(listId, fetchFunction)),
  );

  const fetched: FetchedTasksByList[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      fetched.push(result.value);
      continue;
    }

    const reason: unknown = result.reason;
    if (reason instanceof GraphAuthorizationError || reason instanceof GraphRateLimitError) {
      throw reason;
    }

    const listId = selectedListIds[index] ?? "(unknown)";
    console.warn(
      `Microsoft To Do list [${listId}] failed; treating as empty: [${formatLogError(reason)}].`,
    );
    fetched.push({ listId, tasks: [] });
  }

  return fetched;
};

const fetchAllSelectedTasks = async (
  accessToken: string,
  selectedListIds: readonly string[],
  syncCompletionStatus: boolean,
): Promise<{
  tasksByList: readonly FetchedTasksByList[];
  taskIdToListIdMap: Map<string, string>;
}> => {
  const fetchedTasksByList = await settleTasksByList(selectedListIds, (id) =>
    fetchMicrosoftToDoTasks(accessToken, id, false),
  );

  const fetchedCompletedTasksByList = syncCompletionStatus
    ? await settleTasksByList(selectedListIds, (id) =>
        fetchMicrosoftToDoTasks(accessToken, id, true),
      )
    : [];

  const allFetchedTasksByList = [...fetchedTasksByList, ...fetchedCompletedTasksByList];
  const taskIdToListIdMap = buildTaskIdToListIdMap(allFetchedTasksByList);

  return { tasksByList: fetchedTasksByList, taskIdToListIdMap };
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
    completed: false,
  };
};

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
      updateMicrosoftToDoTaskStatus(accessToken, listId, taskId, completed),
    ),
  );

  return results.map((result, index) => ({
    result,
    change: completionChanges[index],
  }));
};

const findGraphAuthorizationFailure = (
  updateResults: readonly UpdateResult[],
): GraphAuthorizationError | undefined => {
  for (const item of updateResults) {
    if (
      item.result.status === "rejected" &&
      item.result.reason instanceof GraphAuthorizationError
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
      console.error(`Missing Microsoft To Do completion change at index ${index}`);
    } else if (item.result.status === "rejected") {
      console.error(
        `Failed to update completion status for Microsoft To Do task ${item.change.taskId} in list ${item.change.listId}:`,
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

const applyCompletionChangesToMicrosoftToDo = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
  notify: (message: string) => void,
): Promise<readonly CompletionChange[]> => {
  if (completionChanges.length === 0) {
    return [];
  }

  const updateResults = await executeCompletionUpdates(completionChanges, accessToken);
  const authFailure = findGraphAuthorizationFailure(updateResults);
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
  tasksByList: readonly { listId: string; tasks: readonly MicrosoftToDoTask[] }[],
  tenantSegment: string,
  taskIdToListIdMap: Map<string, string>,
  accessToken: string,
  syncHeading: string,
  syncDocument: string,
  syncCompletionStatus: boolean,
  notify: (message: string) => void,
) => {
  const incoming = tasksByList.flatMap(({ listId, tasks }) => {
    const adaptor = createMicrosoftToDoTaskAdaptor(syncHeading, tenantSegment, listId);
    return tasks.map(adaptor);
  });

  try {
    const existing = await readMarkdownSyncItems(file, MICROSOFT_TO_DO_SOURCE);

    let updatedIncoming: readonly SyncItem[] = incoming;
    if (syncCompletionStatus) {
      const completionChanges = detectCompletionChanges(existing, incoming, taskIdToListIdMap);
      const successfulChanges = await applyCompletionChangesToMicrosoftToDo(
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
      MICROSOFT_TO_DO_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file or directory|not found/i.test(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during Microsoft To Do sync: [${message}]. Aborting sync.`);
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
    const { microsoftToDo } = freshSettings;
    if (microsoftToDo === undefined) {
      throw new MicrosoftToDoDisconnectedError();
    }

    await saveSettings({
      ...freshSettings,
      microsoftToDo: {
        ...microsoftToDo,
        credentials: {
          ...microsoftToDo.credentials,
          accessToken,
          expiryDate,
          ...(refreshToken === undefined ? {} : { refreshToken }),
        },
      },
    });
  };

const clearMicrosoftToDoCredentials = async (
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  const freshSettings = await loadSettings();
  await saveSettings({ ...freshSettings, microsoftToDo: undefined });
  new AuthorizationExpiredModal(app, "Microsoft To Do").open();
};

/**
 * Clears credentials only on HTTP 401. Keeps them on 403 (missing Tasks.ReadWrite / consent).
 */
const handleMicrosoftToDoAuthorizationFailure = async (
  error: GraphAuthorizationError,
  notify: (message: string) => void,
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  if (error.status === 401) {
    console.warn(
      `Microsoft Graph access token rejected (${error.status}). Clearing Microsoft To Do credentials...`,
    );
    await clearMicrosoftToDoCredentials(loadSettings, saveSettings, app);
    return;
  }

  notify(
    "Microsoft To Do sync was denied (403). Add delegated Tasks.ReadWrite on the Entra app (admin consent if required), then reconnect Microsoft To Do.",
  );
  console.warn(
    `Microsoft Graph access denied (${error.status}): [${error.message}]. Credentials kept.`,
  );
};

const notifySyncFailure = (error: unknown, notify: (message: string) => void): void => {
  const message = error instanceof Error ? formatUiError(error) : formatUiError(String(error));
  notify(`Microsoft To Do sync failed: ${message}`);
};

/**
 * Create a job to sync Microsoft To Do tasks into the Markdown sync note.
 *
 * Mirrors Google Tasks list + completion semantics: incomplete feed, optional
 * Obsidian→To Do completion write-back, and `shouldPreserveCompletedDeletes`.
 */
export const createMicrosoftToDoJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
  app,
) => ({
  name: "microsoft-to-do",
  task: async () => {
    const settings = await loadSettings();
    const { microsoftToDo, syncDocument, syncHeading, syncCompletionStatus } = settings;

    if (microsoftToDo === undefined) {
      return;
    }

    if (microsoftToDo.selectedListIds.length === 0) {
      return;
    }

    if (config.microsoftClientId.length === 0) {
      return;
    }

    let currentAccessToken: string;
    try {
      currentAccessToken = await ensureAccessToken(
        microsoftToDo,
        config,
        persistRefreshedToken(loadSettings, saveSettings),
      );
    } catch (error) {
      if (error instanceof MicrosoftToDoDisconnectedError) {
        return;
      }
      if (error instanceof InvalidGrantError) {
        console.warn(
          "Microsoft To Do refresh token has been expired or revoked. Clearing credentials...",
        );
        await clearMicrosoftToDoCredentials(loadSettings, saveSettings, app);
        return;
      }
      notifySyncFailure(error, notify);
      return;
    }

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    let tasksByList: readonly { listId: string; tasks: readonly MicrosoftToDoTask[] }[];
    let taskIdToListIdMap: Map<string, string>;

    try {
      const fetchResult = await fetchAllSelectedTasks(
        currentAccessToken,
        microsoftToDo.selectedListIds,
        syncCompletionStatus,
      );
      tasksByList = fetchResult.tasksByList;
      taskIdToListIdMap = fetchResult.taskIdToListIdMap;
    } catch (error) {
      if (error instanceof GraphAuthorizationError) {
        await handleMicrosoftToDoAuthorizationFailure(
          error,
          notify,
          loadSettings,
          saveSettings,
          app,
        );
        return;
      }
      if (error instanceof GraphRateLimitError) {
        notify("Microsoft To Do sync hit a rate limit. Try again later.");
        console.warn(`Microsoft To Do rate limit: [${error.message}].`);
        return;
      }
      notifySyncFailure(error, notify);
      console.error(`Microsoft To Do sync read failed: [${formatLogError(error)}].`);
      return;
    }

    try {
      await syncTasksToFile(
        file,
        tasksByList,
        microsoftToDo.credentials.tenantSegment,
        taskIdToListIdMap,
        currentAccessToken,
        syncHeading,
        syncDocument,
        syncCompletionStatus,
        notify,
      );
    } catch (error) {
      if (error instanceof GraphAuthorizationError) {
        await handleMicrosoftToDoAuthorizationFailure(
          error,
          notify,
          loadSettings,
          saveSettings,
          app,
        );
        return;
      }
      if (error instanceof GraphRateLimitError) {
        notify("Microsoft To Do sync hit a rate limit. Try again later.");
        console.warn(`Microsoft To Do rate limit: [${error.message}].`);
        return;
      }
      notifySyncFailure(error, notify);
      console.error(`Microsoft To Do sync failed: [${formatLogError(error)}].`);
    }
  },
});
