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
import { runtimeSetTimeout } from "@/utils/browser-runtime";
import type { TFile, Vault } from "obsidian";

const VAULT_INIT_RETRY_DELAY_MS = 500;
const AZURE_DEVOPS_NOOP_RECHECK_ATTEMPTS = 2;
const AZURE_DEVOPS_NOOP_RECHECK_DELAY_MS = 250;
const AZURE_DEVOPS_FILE_STABILITY_POLL_ATTEMPTS = 6;
const AZURE_DEVOPS_FILE_STABILITY_POLL_DELAY_MS = 150;
const headingRegex = /^\s*#{1,6}\s/;
const kanbanSettingsStartRegex = /^\s*%%\s*kanban:settings\s*$/;

const computeContentFingerprint = (content: string): string => {
  let hash = Number.parseInt("811c9dc5", 16);
  const fnvPrime = Number.parseInt("01000193", 16);
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.codePointAt(index) ?? 0;
    hash = Math.imul(hash, fnvPrime);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

type SyncDocumentSnapshot = {
  fileMtimeEpochMs: number;
  contentFingerprint: string;
  headingSectionFingerprint: string;
};

const readVaultContent = async (vault: Vault, file: TFile): Promise<string | undefined> => {
  const vaultWithRead = vault as unknown as {
    cachedRead?: (targetFile: TFile) => Promise<string>;
    read?: (targetFile: TFile) => Promise<string>;
  };
  if (typeof vaultWithRead.read === "function") {
    return vaultWithRead.read(file);
  }
  if (typeof vaultWithRead.cachedRead === "function") {
    return vaultWithRead.cachedRead(file);
  }
  return undefined;
};

const extractHeadingSectionContent = (content: string, heading: string): string => {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return "";
  }

  const followingLines = lines.slice(headingIndex + 1);
  const nextHeadingRelativeIndex = followingLines.findIndex((line) => headingRegex.test(line));
  const sectionLines =
    nextHeadingRelativeIndex === -1
      ? followingLines
      : followingLines.slice(0, Math.max(0, nextHeadingRelativeIndex));
  const kanbanSettingsRelativeIndex = sectionLines.findIndex((line) =>
    kanbanSettingsStartRegex.test(line),
  );
  const contentLines =
    kanbanSettingsRelativeIndex === -1
      ? sectionLines
      : sectionLines.slice(0, Math.max(0, kanbanSettingsRelativeIndex));
  return contentLines.join("\n");
};

const buildSyncDocumentSnapshot = async (
  vault: Vault,
  file: TFile,
  syncHeading: string,
): Promise<SyncDocumentSnapshot | undefined> => {
  const content = await readVaultContent(vault, file);
  if (content === undefined) {
    return undefined;
  }

  const sectionContent = extractHeadingSectionContent(content, syncHeading);

  const vaultWithAdapter = vault as unknown as {
    adapter?: { stat?: (path: string) => Promise<{ mtime?: number; size?: number }> };
  };
  const stat = await vaultWithAdapter.adapter?.stat?.(file.path);

  return {
    fileMtimeEpochMs: stat?.mtime ?? -1,
    contentFingerprint: computeContentFingerprint(content),
    headingSectionFingerprint: computeContentFingerprint(sectionContent),
  };
};

class UnstableSyncDocumentError extends Error {}

const waitForStableSyncDocumentSnapshot = async (
  vault: Vault,
  file: TFile,
  syncHeading: string,
): Promise<void> => {
  const initialSnapshot = await buildSyncDocumentSnapshot(vault, file, syncHeading);
  if (initialSnapshot === undefined) {
    return;
  }

  let previousSnapshot = initialSnapshot;
  for (let attempt = 1; attempt <= AZURE_DEVOPS_FILE_STABILITY_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) =>
      runtimeSetTimeout(resolve, AZURE_DEVOPS_FILE_STABILITY_POLL_DELAY_MS),
    );
    const currentSnapshot = await buildSyncDocumentSnapshot(vault, file, syncHeading);
    if (currentSnapshot === undefined) {
      return;
    }

    const fingerprintStable =
      currentSnapshot.contentFingerprint === previousSnapshot.contentFingerprint &&
      currentSnapshot.headingSectionFingerprint === previousSnapshot.headingSectionFingerprint;
    const mtimeStable =
      currentSnapshot.fileMtimeEpochMs < 0 ||
      previousSnapshot.fileMtimeEpochMs < 0 ||
      currentSnapshot.fileMtimeEpochMs === previousSnapshot.fileMtimeEpochMs;

    if (fingerprintStable && mtimeStable) {
      return;
    }
    previousSnapshot = currentSnapshot;
  }

  throw new UnstableSyncDocumentError(
    `Sync document remained unstable after ${AZURE_DEVOPS_FILE_STABILITY_POLL_ATTEMPTS} polling attempts.`,
  );
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
    console.warn(`Sync document [${syncDocument}] not found. Aborting Azure DevOps sync.`);
    return undefined;
  }

  return retryFile;
};

const isMissingFileError = (message: string): boolean =>
  /ENOENT|no such file or directory|not found/i.test(message);

const syncWorkItemsToFile = async (
  vault: Vault,
  file: TFile,
  workItems: readonly AzureDevOpsWorkItem[],
  syncHeading: string,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<AtomicReconcileResult> => {
  const adaptor = mapAzureDevOpsWorkItemToSyncItem(syncHeading);
  const incoming = workItems.map(adaptor);

  try {
    await waitForStableSyncDocumentSnapshot(vault, file, syncHeading);
    let reconcileResult: AtomicReconcileResult = await reconcileSyncSourceAtomically(
      file,
      incoming,
      AZURE_DEVOPS_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );

    for (
      let recheckAttempt = 1;
      incoming.length > 0 &&
      reconcileResult.actions.length === 0 &&
      recheckAttempt <= AZURE_DEVOPS_NOOP_RECHECK_ATTEMPTS;
      recheckAttempt += 1
    ) {
      const delayMs = AZURE_DEVOPS_NOOP_RECHECK_DELAY_MS * recheckAttempt;
      await new Promise((resolve) => runtimeSetTimeout(resolve, delayMs));
      reconcileResult = await reconcileSyncSourceAtomically(
        file,
        incoming,
        AZURE_DEVOPS_SOURCE,
        syncHeading,
        shouldPreserveCompletedDeletes,
      );

      if (reconcileResult.actions.length > 0) {
        break;
      }
    }
    return reconcileResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UnstableSyncDocumentError) {
      notify("Sync document is still changing on disk. Azure DevOps sync skipped; retry shortly.");
      console.warn(`Azure DevOps sync skipped due to unstable sync document: [${message}].`);
      return { actions: [], existingItems: [] };
    }
    if (isMissingFileError(message)) {
      notify(
        `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`,
      );
      console.error(`File missing during Azure DevOps sync: [${message}]. Aborting sync.`);
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
      await syncWorkItemsToFile(vault, file, workItems, syncHeading, syncDocument, notify);
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
