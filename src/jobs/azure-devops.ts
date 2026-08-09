import { mapAzureDevOpsWorkItemToSyncItem } from "@/adaptors/azure-devops";
import type { SyncJobCreator } from "@/jobs/types";
import {
  fetchAssignedWorkItems,
  AzureDevOpsAuthorizationError,
  type AzureDevOpsApiAuth,
  type AzureDevOpsWorkItem,
} from "@/services/azure-devops";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { parseMarkdownSyncItemsFromContent } from "@/sync/reader";
import { AZURE_DEVOPS_SOURCE } from "@/sync/types";
import { reconcileSyncSourceAtomically, type AtomicReconcileResult } from "@/sync/writer";
import type { TFile, Vault } from "obsidian";

const VAULT_INIT_RETRY_DELAY_MS = 500;
const AZURE_DEVOPS_DEBUG_PREFIX = "[AzureDevOps Debug TEMP]";
const AZURE_DEVOPS_NOOP_RECHECK_ATTEMPTS = 2;
const AZURE_DEVOPS_NOOP_RECHECK_DELAY_MS = 250;
const AZURE_DEVOPS_FILE_STABILITY_POLL_ATTEMPTS = 6;
const AZURE_DEVOPS_FILE_STABILITY_POLL_DELAY_MS = 150;
let azureDevOpsRunSequence = 0;
const headingRegex = /^\s*#{1,6}\s/;
const kanbanSettingsStartRegex = /^\s*%%\s*kanban:settings\s*$/;

const createRunId = (): string => {
  azureDevOpsRunSequence += 1;
  return `run-${Date.now()}-${azureDevOpsRunSequence}`;
};

const maskToken = (token: string): string => {
  if (token.length <= 8) {
    return `${"*".repeat(token.length)} (len=${token.length})`;
  }
  const start = token.slice(0, 4);
  const end = token.slice(-4);
  return `${start}...${end} (len=${token.length})`;
};

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
  fileSizeBytes: number;
  fileMtimeEpochMs: number;
  contentLength: number;
  contentFingerprint: string;
  headingSectionLength: number;
  headingSectionFingerprint: string;
  existingIdsInHeadingSection: readonly string[];
  existingIdsInFullFile: readonly string[];
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
  const sectionItems = parseMarkdownSyncItemsFromContent(sectionContent, AZURE_DEVOPS_SOURCE);
  const fullFileItems = parseMarkdownSyncItemsFromContent(content, AZURE_DEVOPS_SOURCE);

  const vaultWithAdapter = vault as unknown as {
    adapter?: { stat?: (path: string) => Promise<{ mtime?: number; size?: number }> };
  };
  const stat = await vaultWithAdapter.adapter?.stat?.(file.path);

  return {
    fileSizeBytes: stat?.size ?? content.length,
    fileMtimeEpochMs: stat?.mtime ?? -1,
    contentLength: content.length,
    contentFingerprint: computeContentFingerprint(content),
    headingSectionLength: sectionContent.length,
    headingSectionFingerprint: computeContentFingerprint(sectionContent),
    existingIdsInHeadingSection: sectionItems.map((item) => item.id),
    existingIdsInFullFile: fullFileItems.map((item) => item.id),
  };
};

const logPreSyncFileTrace = async (
  vault: Vault,
  file: TFile,
  syncHeading: string,
  runId: string,
): Promise<void> => {
  try {
    const snapshot = await buildSyncDocumentSnapshot(vault, file, syncHeading);
    if (snapshot === undefined) {
      console.warn(
        `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Pre-sync trace skipped; vault read API unavailable.`,
        { filePath: file.path },
      );
      return;
    }
    console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Pre-sync file trace.`, {
      filePath: file.path,
      fileSizeBytes: snapshot.fileSizeBytes,
      fileMtimeEpochMs: snapshot.fileMtimeEpochMs,
      contentLength: snapshot.contentLength,
      contentFingerprint: snapshot.contentFingerprint,
      heading: syncHeading,
      headingPresent: snapshot.headingSectionLength > 0,
      headingSectionLength: snapshot.headingSectionLength,
      headingSectionFingerprint: snapshot.headingSectionFingerprint,
      existingIdsInHeadingSection: snapshot.existingIdsInHeadingSection,
      existingIdsInFullFile: snapshot.existingIdsInFullFile,
    });
  } catch (error) {
    console.warn(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Failed to capture pre-sync file trace.`, {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      filePath: file.path,
    });
  }
};

const waitForStableSyncDocumentSnapshot = async (
  vault: Vault,
  file: TFile,
  syncHeading: string,
  runId: string,
): Promise<void> => {
  const initialSnapshot = await buildSyncDocumentSnapshot(vault, file, syncHeading);
  if (initialSnapshot === undefined) {
    console.warn(
      `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Stability wait skipped; vault read API unavailable.`,
      { filePath: file.path },
    );
    return;
  }

  let previousSnapshot = initialSnapshot;
  for (let attempt = 1; attempt <= AZURE_DEVOPS_FILE_STABILITY_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, AZURE_DEVOPS_FILE_STABILITY_POLL_DELAY_MS));
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
      console.info(
        `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file reached stable on-disk snapshot.`,
        {
          attempt,
          contentFingerprint: currentSnapshot.contentFingerprint,
          headingSectionFingerprint: currentSnapshot.headingSectionFingerprint,
          fileMtimeEpochMs: currentSnapshot.fileMtimeEpochMs,
        },
      );
      return;
    }

    console.info(
      `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file still changing; waiting again.`,
      {
        attempt,
        previousContentFingerprint: previousSnapshot.contentFingerprint,
        currentContentFingerprint: currentSnapshot.contentFingerprint,
        previousHeadingSectionFingerprint: previousSnapshot.headingSectionFingerprint,
        currentHeadingSectionFingerprint: currentSnapshot.headingSectionFingerprint,
        previousMtimeEpochMs: previousSnapshot.fileMtimeEpochMs,
        currentMtimeEpochMs: currentSnapshot.fileMtimeEpochMs,
      },
    );
    previousSnapshot = currentSnapshot;
  }

  console.warn(
    `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file did not stabilise within poll budget; proceeding with latest snapshot.`,
    {
      maxAttempts: AZURE_DEVOPS_FILE_STABILITY_POLL_ATTEMPTS,
      pollDelayMs: AZURE_DEVOPS_FILE_STABILITY_POLL_DELAY_MS,
    },
  );
};

const getSyncFileWithRetry = async (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
  runId: string,
): Promise<TFile | undefined> => {
  console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Resolving sync file.`, { syncDocument });
  const file = vault.getFileByPath(syncDocument);
  if (file !== null) {
    console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file found on first attempt.`, {
      filePath: file.path,
    });
    return file;
  }

  console.info(
    `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file not found on first attempt; retrying after delay.`,
    { retryDelayMs: VAULT_INIT_RETRY_DELAY_MS, syncDocument },
  );
  await new Promise((resolve) => setTimeout(resolve, VAULT_INIT_RETRY_DELAY_MS));
  const retryFile = vault.getFileByPath(syncDocument);

  if (retryFile === null) {
    notify(`Sync document "${syncDocument}" not found. Please update settings or create the file.`);
    console.warn(`Sync document [${syncDocument}] not found. Aborting Azure DevOps sync.`);
    console.warn(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file missing after retry.`);
    return undefined;
  }

  console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Sync file found on retry.`, {
    filePath: retryFile.path,
  });
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
  runId: string,
): Promise<AtomicReconcileResult> => {
  const adaptor = mapAzureDevOpsWorkItemToSyncItem(syncHeading);
  const incoming = workItems.map(adaptor);
  console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Starting reconcileSyncSourceAtomically.`, {
    filePath: file.path,
    syncDocument,
    syncHeading,
    incomingCount: incoming.length,
    sampleItemIds: incoming.slice(0, 5).map((item) => item.id),
  });

  try {
    await waitForStableSyncDocumentSnapshot(vault, file, syncHeading, runId);
    let reconcileResult: AtomicReconcileResult = await reconcileSyncSourceAtomically(
      file,
      incoming,
      AZURE_DEVOPS_SOURCE,
      syncHeading,
      shouldPreserveCompletedDeletes,
    );
    let createCount = reconcileResult.actions.filter(
      (action) => action.operation === "create",
    ).length;
    let updateCount = reconcileResult.actions.filter(
      (action) => action.operation === "update",
    ).length;
    let deleteCount = reconcileResult.actions.filter(
      (action) => action.operation === "delete",
    ).length;

    for (
      let recheckAttempt = 1;
      incoming.length > 0 &&
      reconcileResult.actions.length === 0 &&
      recheckAttempt <= AZURE_DEVOPS_NOOP_RECHECK_ATTEMPTS;
      recheckAttempt += 1
    ) {
      const delayMs = AZURE_DEVOPS_NOOP_RECHECK_DELAY_MS * recheckAttempt;
      console.info(
        `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Reconcile no-op with incoming items; rechecking for delayed file-state updates.`,
        {
          recheckAttempt,
          maxAttempts: AZURE_DEVOPS_NOOP_RECHECK_ATTEMPTS,
          delayMs,
          incomingCount: incoming.length,
          existingCount: reconcileResult.existingItems.length,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      reconcileResult = await reconcileSyncSourceAtomically(
        file,
        incoming,
        AZURE_DEVOPS_SOURCE,
        syncHeading,
        shouldPreserveCompletedDeletes,
      );
      createCount = reconcileResult.actions.filter(
        (action) => action.operation === "create",
      ).length;
      updateCount = reconcileResult.actions.filter(
        (action) => action.operation === "update",
      ).length;
      deleteCount = reconcileResult.actions.filter(
        (action) => action.operation === "delete",
      ).length;

      console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Reconcile recheck result.`, {
        recheckAttempt,
        incomingCount: incoming.length,
        existingCount: reconcileResult.existingItems.length,
        actionCount: reconcileResult.actions.length,
        createCount,
        updateCount,
        deleteCount,
      });

      if (reconcileResult.actions.length > 0) {
        break;
      }
    }

    console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Reconcile completed successfully.`, {
      incomingCount: incoming.length,
      existingCount: reconcileResult.existingItems.length,
      actionCount: reconcileResult.actions.length,
      createCount,
      updateCount,
      deleteCount,
    });
    return reconcileResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Reconcile failed.`, {
      errorMessage: message,
      errorName: error instanceof Error ? error.name : typeof error,
    });
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
    const runId = createRunId();
    console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Azure DevOps job start.`);
    const settings = await loadSettings();
    const { syncDocument, syncHeading } = settings;
    const personalAccessToken = settings.azureDevOpsPersonalAccessToken.trim();
    const organization = settings.azureDevOpsOrganization.trim();
    const projectName = settings.azureDevOpsProjectName.trim();
    console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Loaded settings snapshot.`, {
      syncDocument,
      syncHeading,
      organization,
      projectName,
      patMasked: maskToken(personalAccessToken),
      patRawLength: settings.azureDevOpsPersonalAccessToken.length,
      patTrimmedLength: personalAccessToken.length,
    });

    if (personalAccessToken.length === 0 || organization.length === 0 || projectName.length === 0) {
      console.warn(
        `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Early return due to missing PAT settings.`,
        {
          hasPat: personalAccessToken.length > 0,
          hasOrganization: organization.length > 0,
          hasProjectName: projectName.length > 0,
        },
      );
      return;
    }

    const auth: AzureDevOpsApiAuth = { kind: "pat", personalAccessToken };

    const file = await getSyncFileWithRetry(vault, syncDocument, notify, runId);
    if (file === undefined) {
      console.warn(
        `${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Aborting because sync file was unresolved.`,
      );
      return;
    }
    await logPreSyncFileTrace(vault, file, syncHeading, runId);

    let workItems: readonly AzureDevOpsWorkItem[];
    try {
      console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Fetching assigned work items.`, {
        organization,
        projectName,
      });
      workItems = await fetchAssignedWorkItems(auth, organization, projectName);
      console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Fetch completed.`, {
        fetchedCount: workItems.length,
        sampleIds: workItems.slice(0, 5).map((item) => item.id),
      });
    } catch (error) {
      console.error(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Fetch failed.`, {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof AzureDevOpsAuthorizationError) {
        notify(
          "Azure DevOps PAT authorization failed. Verify PAT scopes and organisation/project values.",
        );
        return;
      }
      throw error;
    }

    try {
      await syncWorkItemsToFile(vault, file, workItems, syncHeading, syncDocument, notify, runId);
    } catch (error) {
      if (error instanceof AzureDevOpsAuthorizationError) {
        notify(
          "Azure DevOps PAT authorization failed. Verify PAT scopes and organisation/project values.",
        );
        return;
      }
      throw error;
    }
    console.info(`${AZURE_DEVOPS_DEBUG_PREFIX} [${runId}] Azure DevOps job finished.`);
  },
});
