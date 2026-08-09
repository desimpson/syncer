import { mapAzureDevOpsWorkItemToSyncItem } from "@/adaptors/azure-devops";
import type { SyncJobCreator } from "@/jobs/types";
import { AzureDevOpsAuth, InvalidGrantError } from "@/auth";
import type { AzureDevOpsSettings, PluginConfig, PluginSettings } from "@/plugin/types";
import {
  fetchAssignedWorkItems,
  AzureDevOpsAuthorizationError,
  type AzureDevOpsWorkItem,
} from "@/services/azure-devops";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { AZURE_DEVOPS_SOURCE } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import type { TFile, Vault } from "obsidian";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";

const VAULT_INIT_RETRY_DELAY_MS = 500;

class AzureDevOpsDisconnectedError extends Error {
  public constructor() {
    super("Azure DevOps disconnected during sync");
    this.name = "AzureDevOpsDisconnectedError";
  }
}

const ensureAccessToken = async (
  azureDevOps: AzureDevOpsSettings,
  config: PluginConfig,
  persist: (update: {
    accessToken: string;
    expiryDate: number;
    refreshToken?: string;
  }) => Promise<void>,
): Promise<string> => {
  const { credentials: token } = azureDevOps;

  if (token.expiryDate < Date.now()) {
    const { accessToken, expiryDate, refreshToken } = await AzureDevOpsAuth.refreshAccessToken(
      config.azureDevOpsClientId,
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

  await new Promise((resolve) => setTimeout(resolve, VAULT_INIT_RETRY_DELAY_MS));
  const retryFile = vault.getFileByPath(syncDocument);

  if (retryFile === null) {
    notify(`Sync document "${syncDocument}" not found. Please update settings or create the file.`);
    console.warn(`Sync document [${syncDocument}] not found. Aborting Azure DevOps sync.`);
    return undefined;
  }

  return retryFile;
};

const isMissingFileError = (message: string): boolean =>
  /ENOENT|no such file or directory|not found/i.test(message);

const syncWorkItemsToFile = async (
  file: TFile,
  workItems: readonly AzureDevOpsWorkItem[],
  syncHeading: string,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<void> => {
  const adaptor = mapAzureDevOpsWorkItemToSyncItem(syncHeading);
  const incoming = workItems.map(adaptor);

  try {
    await reconcileSyncSourceAtomically(
      file,
      incoming,
      AZURE_DEVOPS_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingFileError(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during Azure DevOps sync: [${message}]. Aborting sync.`);
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
    const { azureDevOps } = freshSettings;
    if (azureDevOps === undefined) {
      throw new AzureDevOpsDisconnectedError();
    }

    await saveSettings({
      ...freshSettings,
      azureDevOps: {
        ...azureDevOps,
        credentials: {
          ...azureDevOps.credentials,
          accessToken,
          expiryDate,
          ...(refreshToken === undefined ? {} : { refreshToken }),
        },
      },
    });
  };

const clearAzureDevOpsCredentials = async (
  loadSettings: () => Promise<PluginSettings>,
  saveSettings: (s: PluginSettings) => Promise<void>,
  app: Parameters<SyncJobCreator>[5],
): Promise<void> => {
  const freshSettings = await loadSettings();
  await saveSettings({ ...freshSettings, azureDevOps: undefined });
  new AuthorizationExpiredModal(app).open();
};

const resolveSelectedProjectName = (azureDevOps: AzureDevOpsSettings): string | undefined => {
  const { selectedProjectId, availableProjects } = azureDevOps;
  if (selectedProjectId.length === 0) {
    return undefined;
  }

  return availableProjects.find((project) => project.id === selectedProjectId)?.name;
};

/**
 * Create a job to sync assigned Azure DevOps work items into the Markdown sync note.
 *
 * @param loadSettings - Function that returns the current plugin settings
 * @param saveSettings - Function to persist updated plugin settings
 * @param config - The plugin configuration
 * @param vault - Obsidian vault used to resolve the sync document
 * @param notify - Function to display user-facing messages
 * @param app - Obsidian app instance (auth-expired modal)
 * @returns A `SyncJob` that can be scheduled
 */
export const createAzureDevOpsJob: SyncJobCreator = (
  loadSettings,
  saveSettings,
  config,
  vault,
  notify,
  app,
) => ({
  name: "azure-devops",
  task: async () => {
    const settings = await loadSettings();
    const { azureDevOps, syncDocument, syncHeading } = settings;

    if (azureDevOps === undefined) {
      return;
    }

    if (config.azureDevOpsClientId.length === 0) {
      return;
    }

    const projectName = resolveSelectedProjectName(azureDevOps);
    if (projectName === undefined) {
      return;
    }

    let currentAccessToken: string;
    try {
      currentAccessToken = await ensureAccessToken(
        azureDevOps,
        config,
        persistRefreshedToken(loadSettings, saveSettings),
      );
    } catch (error) {
      if (error instanceof AzureDevOpsDisconnectedError) {
        return;
      }
      if (error instanceof InvalidGrantError) {
        console.warn(
          "Azure DevOps refresh token has been expired or revoked. Clearing credentials...",
        );
        await clearAzureDevOpsCredentials(loadSettings, saveSettings, app);
        return;
      }
      throw error;
    }

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    let workItems: readonly AzureDevOpsWorkItem[];
    try {
      workItems = await fetchAssignedWorkItems(
        currentAccessToken,
        azureDevOps.organization,
        projectName,
      );
    } catch (error) {
      if (error instanceof AzureDevOpsAuthorizationError) {
        console.warn(
          `Azure DevOps authorization failed (${error.status}). Clearing credentials...`,
        );
        await clearAzureDevOpsCredentials(loadSettings, saveSettings, app);
        return;
      }
      throw error;
    }

    try {
      await syncWorkItemsToFile(file, workItems, syncHeading, syncDocument, notify);
    } catch (error) {
      if (error instanceof AzureDevOpsAuthorizationError) {
        console.warn(
          `Azure DevOps authorization failed (${error.status}). Clearing credentials...`,
        );
        await clearAzureDevOpsCredentials(loadSettings, saveSettings, app);
        return;
      }
      throw error;
    }
  },
});
