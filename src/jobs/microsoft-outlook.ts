import { mapOutlookMessageToSyncItem } from "@/adaptors/microsoft-outlook";
import type { SyncJobCreator } from "@/jobs/types";
import { MicrosoftAuth, InvalidGrantError } from "@/auth";
import type { PluginConfig, MicrosoftOutlookSettings, PluginSettings } from "@/plugin/types";
import {
  fetchFlaggedMessages,
  updateOutlookMessageFlag,
  type OutlookFlaggedMessage,
} from "@/services/outlook-mail";
import { filterActions, generateSyncActions, shouldPreserveCompletedDeletes } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { MICROSOFT_OUTLOOK_SOURCE, type SyncItem } from "@/sync/types";
import { writeSyncActions } from "@/sync/writer";
import type { TFile, Vault } from "obsidian";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";

const VAULT_INIT_RETRY_DELAY_MS = 500;

type CompletionChange = {
  messageId: string;
  completed: boolean;
};

const ensureAccessToken = async (
  outlook: MicrosoftOutlookSettings,
  config: PluginConfig,
  persist: (update: { accessToken: string; expiryDate: number }) => Promise<void>,
): Promise<string> => {
  const { credentials: token } = outlook;

  if (token.expiryDate < Date.now()) {
    const { accessToken, expiryDate } = await MicrosoftAuth.refreshAccessToken(
      config.microsoftClientId,
      {
        refreshToken: token.refreshToken,
        tenantSegment: token.tenantSegment,
      },
    );

    await persist({ accessToken, expiryDate });
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

  await new Promise((resolve) => setTimeout(resolve, VAULT_INIT_RETRY_DELAY_MS));
  const retryFile = vault.getFileByPath(syncDocument);

  if (retryFile === null) {
    notify(`Sync document "${syncDocument}" not found. Please update settings or create the file.`);
    console.warn(`Sync document [${syncDocument}] not found. Aborting Outlook sync.`);
    return undefined;
  }

  return retryFile;
};

/**
 * Maps each incoming message id to a stable "list" key so completion sync can reuse the same
 * `detectCompletionChanges` shape as Google Tasks (id → list id). Outlook has no task list id.
 */
const buildOutlookMessageIdToListKeyMap = (incoming: readonly SyncItem[]): Map<string, string> =>
  new Map(incoming.map((item) => [item.id, item.id]));

const detectChangeForTaskInBoth = (
  existingItem: SyncItem,
  incomingItem: SyncItem,
  listId: string | undefined,
): CompletionChange | undefined => {
  if (existingItem.completed === incomingItem.completed || listId === undefined) {
    return undefined;
  }

  return {
    messageId: existingItem.id,
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
    messageId: existingItem.id,
    completed: false,
  };
};

const detectCompletionChanges = (
  existing: readonly SyncItem[],
  incoming: readonly SyncItem[],
  messageIdToListKey: Map<string, string>,
): readonly CompletionChange[] => {
  const incomingMap = new Map(incoming.map((item) => [item.id, item]));

  return existing
    .map((existingItem) => {
      const incomingItem = incomingMap.get(existingItem.id);
      const listKey = messageIdToListKey.get(existingItem.id);

      if (incomingItem !== undefined) {
        return detectChangeForTaskInBoth(existingItem, incomingItem, listKey);
      }

      return detectChangeForUncompletedTask(existingItem, listKey);
    })
    .filter((change): change is CompletionChange => change !== undefined);
};

type UpdateResult = {
  result: PromiseSettledResult<void>;
  change: CompletionChange | undefined;
};

const applyCompletionChangesToGraph = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
): Promise<readonly UpdateResult[]> => {
  const results = await Promise.allSettled(
    completionChanges.map(({ messageId, completed }) =>
      updateOutlookMessageFlag(accessToken, messageId, completed),
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
      console.error(`Missing Outlook completion change at index ${index}`);
    } else if (item.result.status === "rejected") {
      console.error(
        `Failed to update Outlook flag for message ${item.change.messageId}:`,
        item.result.reason,
      );
      notify(`Failed to sync Outlook flag for message: ${item.change.messageId}`);
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

const applyCompletionChangesToOutlook = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
  notify: (message: string) => void,
): Promise<readonly CompletionChange[]> => {
  if (completionChanges.length === 0) {
    return [];
  }

  const updateResults = await applyCompletionChangesToGraph(completionChanges, accessToken);
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

  const changesMap = new Map(
    completionChanges.map((change) => [change.messageId, change.completed]),
  );
  const incomingIds = new Set(incoming.map((item) => item.id));

  const updatedIncoming = incoming.map((item) => {
    const updatedCompleted = changesMap.get(item.id);
    return updatedCompleted === undefined ? item : { ...item, completed: updatedCompleted };
  });

  const existingMap = new Map(existing.map((item) => [item.id, item]));
  const uncompletedMessages = completionChanges
    .filter((change) => !change.completed && !incomingIds.has(change.messageId))
    .map((change) => {
      const existingItem = existingMap.get(change.messageId);
      return existingItem === undefined ? undefined : { ...existingItem, completed: false };
    })
    .filter((item): item is SyncItem => item !== undefined);

  return [...updatedIncoming, ...uncompletedMessages];
};

const syncOutlookMessagesToFile = async (
  file: TFile,
  messages: readonly OutlookFlaggedMessage[],
  accessToken: string,
  syncHeading: string,
  syncDocument: string,
  syncCompletionStatus: boolean,
  notify: (message: string) => void,
) => {
  const adaptor = mapOutlookMessageToSyncItem(syncHeading);
  const incoming = messages.map(adaptor);
  const messageIdToListKey = buildOutlookMessageIdToListKeyMap(incoming);

  try {
    const existing = await readMarkdownSyncItems(file, MICROSOFT_OUTLOOK_SOURCE);

    let updatedIncoming: readonly SyncItem[] = incoming;
    if (syncCompletionStatus) {
      const completionChanges = detectCompletionChanges(existing, incoming, messageIdToListKey);
      const successfulChanges = await applyCompletionChangesToOutlook(
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
    const actions = filterActions(allActions, shouldPreserveCompletedDeletes);

    await writeSyncActions(file, actions, syncHeading);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file or directory|not found/i.test(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during Outlook sync: [${message}]. Aborting sync.`);
      return;
    }
    throw error;
  }
};

/**
 * Create a job to sync flagged Outlook messages into the Markdown sync note.
 */
export const createMicrosoftOutlookJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
  app,
) => ({
  name: "microsoft-outlook",
  task: async () => {
    const settings = await loadSettings();
    const { microsoftOutlook, syncDocument, syncHeading, syncCompletionStatus } = settings;

    if (microsoftOutlook === undefined) {
      return;
    }

    if (config.microsoftClientId.length === 0) {
      return;
    }

    let currentAccessToken: string;
    try {
      currentAccessToken = await ensureAccessToken(
        microsoftOutlook,
        config,
        async ({ accessToken, expiryDate }) => {
          const updatedSettings: PluginSettings = {
            ...settings,
            microsoftOutlook: {
              ...microsoftOutlook,
              credentials: { ...microsoftOutlook.credentials, accessToken, expiryDate },
            },
          };
          await saveSettings(updatedSettings);
        },
      );
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        console.warn(
          "Microsoft Outlook refresh token has been expired or revoked. Clearing credentials...",
        );
        const freshSettings = await loadSettings();
        await saveSettings({ ...freshSettings, microsoftOutlook: undefined });
        new AuthorizationExpiredModal(app).open();
        return;
      }
      throw error;
    }

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    const messages = await fetchFlaggedMessages(currentAccessToken);

    await syncOutlookMessagesToFile(
      file,
      messages,
      currentAccessToken,
      syncHeading,
      syncDocument,
      syncCompletionStatus,
      notify,
    );
  },
});
