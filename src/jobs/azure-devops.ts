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
import { reconcileSyncSourceAtomically, type AtomicReconcileResult } from "@/sync/writer";
import {
  notifyIfSyncDocumentUnavailable,
  resolveReadableSyncDocument,
} from "@/sync/resolve-sync-document";
import type { TFile } from "obsidian";

const syncWorkItemsToFile = async (
  vault: Parameters<SyncJobCreator>[3],
  file: TFile,
  workItems: readonly AzureDevOpsWorkItem[],
  syncHeading: string,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<AtomicReconcileResult> => {
  const adaptor = mapAzureDevOpsWorkItemToSyncItem(syncHeading);
  const incoming = workItems.map(adaptor);

  try {
    return await reconcileSyncSourceAtomically(
      file,
      incoming,
      AZURE_DEVOPS_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );
  } catch (error) {
    if (await notifyIfSyncDocumentUnavailable(vault, syncDocument, notify)) {
      return { actions: [], existingItems: [] };
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

    const file = await resolveReadableSyncDocument(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    try {
      const workItems = await fetchAssignedWorkItems(auth, organization, projectName);
      await syncWorkItemsToFile(vault, file, workItems, syncHeading, syncDocument, notify);
    } catch (error) {
      if (error instanceof AzureDevOpsAuthorizationError) {
        notify(
          "Azure DevOps PAT authorization failed. Verify PAT scopes and organisation/project values.",
        );
        return;
      }
      if (await notifyIfSyncDocumentUnavailable(vault, syncDocument, notify)) {
        return;
      }
      throw error;
    }
  },
});
