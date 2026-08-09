import { mapAzureDevOpsWorkItemToSyncItem } from "@/adaptors/azure-devops";
import type { SyncJobCreator } from "@/jobs/types";
import {
  fetchAssignedWorkItems,
  AzureDevOpsAuthorizationError,
  type AzureDevOpsApiAuth,
  type AzureDevOpsWorkItem,
} from "@/services/azure-devops";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { AZURE_DEVOPS_SOURCE } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import type { TFile, Vault } from "obsidian";

const VAULT_INIT_RETRY_DELAY_MS = 500;

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
  _saveSettings,
  _config,
  vault,
  notify,
  _app,
) => ({
  name: "azure-devops",
  task: async () => {
    const settings = await loadSettings();
    const { syncDocument, syncHeading } = settings;
    const personalAccessToken = settings.azureDevOpsPersonalAccessToken.trim();
    const organization = settings.azureDevOpsOrganization.trim();
    const projectName = settings.azureDevOpsProjectName.trim();

    if (personalAccessToken.length === 0 || organization.length === 0 || projectName.length === 0) {
      return;
    }

    const auth: AzureDevOpsApiAuth = { kind: "pat", personalAccessToken };

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    let workItems: readonly AzureDevOpsWorkItem[];
    try {
      workItems = await fetchAssignedWorkItems(auth, organization, projectName);
    } catch (error) {
      if (error instanceof AzureDevOpsAuthorizationError) {
        notify(
          "Azure DevOps PAT authorization failed. Verify PAT scopes and organisation/project values.",
        );
        return;
      }
      throw error;
    }

    try {
      await syncWorkItemsToFile(file, workItems, syncHeading, syncDocument, notify);
    } catch (error) {
      if (error instanceof AzureDevOpsAuthorizationError) {
        notify(
          "Azure DevOps PAT authorization failed. Verify PAT scopes and organisation/project values.",
        );
        return;
      }
      throw error;
    }
  },
});
