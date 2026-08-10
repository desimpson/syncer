import { mapGmailMessageToSyncItem } from "@/adaptors/gmail-starred";
import type { SyncJobCreator } from "@/jobs/types";
import { GoogleAuth, InvalidGrantError } from "@/auth";
import type { GmailStarredSettings, PluginConfig, PluginSettings } from "@/plugin/types";
import {
  fetchStarredMessages,
  updateGmailMessageStarred,
  GmailAuthorizationError,
  GmailRateLimitError,
  type GmailStarredMessage,
} from "@/services/gmail-starred";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { GMAIL_STARRED_SOURCE, type SyncItem } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import { formatUiError } from "@/utils/error-formatters";
import type { TFile, Vault } from "obsidian";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";

const VAULT_INIT_RETRY_DELAY_MS = 500;

type CompletionChange = {
  messageId: string;
  completed: boolean;
};

class GmailStarredDisconnectedError extends Error {
  public constructor() {
    super("Gmail Starred disconnected during sync");
    this.name = "GmailStarredDisconnectedError";
  }
}

const ensureAccessToken = async (
  gmailStarred: GmailStarredSettings,
  config: PluginConfig,
  persist: (update: {
    accessToken: string;
    expiryDate: number;
    refreshToken?: string;
  }) => Promise<void>,
): Promise<string> => {
  const { credentials: token } = gmailStarred;

  if (token.expiryDate < Date.now()) {
    const { accessToken, expiryDate } = await GoogleAuth.refreshAccessToken(
      config.googleClientId,
      token.refreshToken,
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
    console.warn(`Sync document [${syncDocument}] not found. Aborting Gmail Starred sync.`);
    return undefined;
  }

  return retryFile;
};

const buildGmailMessageIdToListKeyMap = (items: readonly SyncItem[]): Map<string, string> =>
  new Map(
    items.filter((item) => item.source === GMAIL_STARRED_SOURCE).map((item) => [item.id, item.id]),
  );

const detectChangeForTaskInBoth = (
  existingItem: SyncItem,
  incomingItem: SyncItem,
  messageKey: string | undefined,
): CompletionChange | undefined => {
  if (existingItem.completed === incomingItem.completed || messageKey === undefined) {
    return undefined;
  }

  return {
    messageId: existingItem.id,
    completed: existingItem.completed,
  };
};

const detectChangeForUncompletedTask = (
  existingItem: SyncItem,
  messageKey: string | undefined,
): CompletionChange | undefined => {
  if (existingItem.completed || messageKey === undefined) {
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
      const messageKey = messageIdToListKey.get(existingItem.id);

      if (incomingItem !== undefined) {
        return detectChangeForTaskInBoth(existingItem, incomingItem, messageKey);
      }

      return detectChangeForUncompletedTask(existingItem, messageKey);
    })
    .filter((change): change is CompletionChange => change !== undefined);
};

type UpdateResult = {
  result: PromiseSettledResult<void>;
  change: CompletionChange | undefined;
};

const applyCompletionChangesToGmail = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
): Promise<readonly UpdateResult[]> => {
  const results = await Promise.allSettled(
    completionChanges.map(({ messageId, completed }) =>
      updateGmailMessageStarred(accessToken, messageId, !completed),
    ),
  );

  return results.map((result, index) => ({
    result,
    change: completionChanges[index],
  }));
};

const reportFailedGmailPatches = (
  updateResults: readonly UpdateResult[],
  notify: (message: string) => void,
): void => {
  updateResults.forEach((item, index) => {
    if (item.change === undefined) {
      console.error(`Missing Gmail Starred completion change at index ${index}`);
      return;
    }
    if (item.result.status !== "rejected") {
      return;
    }
    console.error(
      `Failed to update Gmail star for message ${item.change.messageId}:`,
      item.result.reason,
    );
    notify(`Failed to sync Gmail star for message: ${item.change.messageId}`);
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

const findGmailAuthorizationFailure = (
  updateResults: readonly UpdateResult[],
): GmailAuthorizationError | undefined => {
  for (const item of updateResults) {
    if (
      item.result.status === "rejected" &&
      item.result.reason instanceof GmailAuthorizationError
    ) {
      return item.result.reason;
    }
  }
  return undefined;
};

const applyCompletionChangesToStarredMail = async (
  completionChanges: readonly CompletionChange[],
  accessToken: string,
  notify: (message: string) => void,
): Promise<readonly CompletionChange[]> => {
  if (completionChanges.length === 0) {
    return [];
  }

  const updateResults = await applyCompletionChangesToGmail(completionChanges, accessToken);
  const authFailure = findGmailAuthorizationFailure(updateResults);
  if (authFailure !== undefined) {
    throw authFailure;
  }

  reportFailedGmailPatches(updateResults, notify);
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

const mergeCompletionFromMarkdown = async (
  syncCompletionStatus: boolean,
  existing: readonly SyncItem[],
  incoming: readonly SyncItem[],
  messageIdToListKey: Map<string, string>,
  accessToken: string,
  notify: (message: string) => void,
): Promise<readonly SyncItem[]> => {
  if (!syncCompletionStatus) {
    return incoming;
  }
  const completionChanges = detectCompletionChanges(existing, incoming, messageIdToListKey);
  const successfulChanges = await applyCompletionChangesToStarredMail(
    completionChanges,
    accessToken,
    notify,
  );
  return updateIncomingItemsWithCompletionChanges(incoming, successfulChanges, existing);
};

const isMissingFileError = (message: string): boolean =>
  /ENOENT|no such file or directory|not found/i.test(message);

const syncGmailMessagesToFile = async (
  file: TFile,
  messages: readonly GmailStarredMessage[],
  accessToken: string,
  syncHeading: string,
  syncDocument: string,
  syncCompletionStatus: boolean,
  notify: (message: string) => void,
) => {
  const adaptor = mapGmailMessageToSyncItem(syncHeading);
  const incoming = messages.map(adaptor);

  try {
    const existing = await readMarkdownSyncItems(file, GMAIL_STARRED_SOURCE);
    const messageIdToListKey = buildGmailMessageIdToListKeyMap([...existing, ...incoming]);
    const updatedIncoming = await mergeCompletionFromMarkdown(
      syncCompletionStatus,
      existing,
      incoming,
      messageIdToListKey,
      accessToken,
      notify,
    );
    await reconcileSyncSourceAtomically(
      file,
      updatedIncoming,
      GMAIL_STARRED_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingFileError(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during Gmail Starred sync: [${message}]. Aborting sync.`);
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
    const { gmailStarred } = freshSettings;
    if (gmailStarred === undefined) {
      throw new GmailStarredDisconnectedError();
    }

    await saveSettings({
      ...freshSettings,
      gmailStarred: {
        ...gmailStarred,
        credentials: {
          ...gmailStarred.credentials,
          accessToken,
          expiryDate,
          ...(refreshToken === undefined ? {} : { refreshToken }),
        },
      },
    });
  };

const clearGmailStarredCredentials = async (
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  const freshSettings = await loadSettings();
  await saveSettings({ ...freshSettings, gmailStarred: undefined });
  new AuthorizationExpiredModal(app).open();
};

const handleGmailAuthorizationFailure = async (
  error: GmailAuthorizationError,
  notify: (message: string) => void,
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  if (error.status === 401) {
    console.warn(`Gmail access token rejected (${error.status}). Clearing credentials...`);
    await clearGmailStarredCredentials(loadSettings, saveSettings, app);
    return;
  }

  notify(
    "Gmail Starred sync was denied (403). Enable the Gmail API on your Google Cloud project and ensure gmail.modify is on the OAuth consent screen, then reconnect.",
  );
  console.warn(`Gmail API access denied (${error.status}): [${error.message}]. Credentials kept.`);
};

const notifySyncFailure = (error: unknown, notify: (message: string) => void): void => {
  const message = error instanceof Error ? formatUiError(error) : formatUiError(String(error));
  notify(`Gmail Starred sync failed: ${message}`);
};

/**
 * Create a job to sync starred Gmail messages into the Markdown sync note.
 */
export const createGmailStarredJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
  app,
) => ({
  name: "gmail-starred",
  task: async () => {
    const settings = await loadSettings();
    const { gmailStarred, gmailStarredMaxItems, syncDocument, syncHeading, syncCompletionStatus } =
      settings;

    if (gmailStarred === undefined) {
      return;
    }

    if (config.googleClientId.length === 0) {
      return;
    }

    let currentAccessToken: string;
    try {
      currentAccessToken = await ensureAccessToken(
        gmailStarred,
        config,
        persistRefreshedToken(loadSettings, saveSettings),
      );
    } catch (error) {
      if (error instanceof GmailStarredDisconnectedError) {
        return;
      }
      if (error instanceof InvalidGrantError) {
        console.warn(
          "Gmail Starred refresh token has been expired or revoked. Clearing credentials...",
        );
        await clearGmailStarredCredentials(loadSettings, saveSettings, app);
        return;
      }
      notifySyncFailure(error, notify);
      return;
    }

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    let messages: readonly GmailStarredMessage[];
    let truncated = false;
    try {
      const fetchResult = await fetchStarredMessages(currentAccessToken, gmailStarredMaxItems);
      messages = fetchResult.messages;
      truncated = fetchResult.truncated;
    } catch (error) {
      if (error instanceof GmailAuthorizationError) {
        await handleGmailAuthorizationFailure(error, notify, loadSettings, saveSettings, app);
        return;
      }
      if (error instanceof GmailRateLimitError) {
        notify(
          "Gmail Starred sync hit a rate limit. Try again later or reduce starred mail volume.",
        );
        console.warn(`Gmail Starred rate limit: [${error.message}].`);
        return;
      }
      notifySyncFailure(error, notify);
      return;
    }

    if (truncated) {
      notify(
        `Gmail Starred sync included the newest ${messages.length} starred messages from a limited window. Older stars may be omitted until they fall within the sync window.`,
      );
    }

    try {
      await syncGmailMessagesToFile(
        file,
        messages,
        currentAccessToken,
        syncHeading,
        syncDocument,
        syncCompletionStatus,
        notify,
      );
    } catch (error) {
      if (error instanceof GmailAuthorizationError) {
        await handleGmailAuthorizationFailure(error, notify, loadSettings, saveSettings, app);
        return;
      }
      notifySyncFailure(error, notify);
    }
  },
});
