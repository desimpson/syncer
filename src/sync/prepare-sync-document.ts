import { runtimeSetTimeout } from "@/utils/browser-runtime";
import {
  allocatePrepareTickId,
  prepareSyncDocumentDebugError,
  prepareSyncDocumentDebugLog,
  prepareSyncDocumentDebugWarn,
} from "@/sync/prepare-sync-document-debug";
import type { TFile, Vault } from "obsidian";

export const SYNC_DOCUMENT_STABILITY_POLL_ATTEMPTS = 6;
export const SYNC_DOCUMENT_STABILITY_POLL_DELAY_MS = 150;
export const SYNC_DOCUMENT_VAULT_INIT_RETRY_DELAY_MS = 500;

export const PREPARE_SYNC_DOCUMENT_UNSTABLE_NOTICE =
  "Sync document is still changing on disk. Sync skipped; retry shortly.";

const headingRegex = /^\s*#{1,6}\s/;
const kanbanSettingsStartRegex = /^\s*%%\s*kanban:settings\s*$/;

type SyncDocumentSnapshot = {
  fileMtimeEpochMs: number;
  fileSizeBytes: number;
  contentLength: number;
  sectionLength: number;
  contentFingerprint: string;
  headingSectionFingerprint: string;
};

export class UnstableSyncDocumentError extends Error {
  public constructor(message?: string) {
    super(
      message ??
        `Sync document remained unstable after ${SYNC_DOCUMENT_STABILITY_POLL_ATTEMPTS} polling attempts.`,
    );
    this.name = "UnstableSyncDocumentError";
  }
}

export class PrepareSyncDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PrepareSyncDocumentError";
  }
}

export const formatPrepareSyncDocumentFailureNotice = (
  syncDocument: string,
  message: string,
): string => {
  if (/not found/i.test(message)) {
    return `Sync document "${syncDocument}" not found. Please update settings or create the file.`;
  }
  if (/missing on disk|ENOENT|no such file/i.test(message)) {
    return `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`;
  }
  return `Sync document prepare failed: ${message}`;
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

const summariseSnapshot = (snapshot: SyncDocumentSnapshot) => ({
  mtime: snapshot.fileMtimeEpochMs,
  size: snapshot.fileSizeBytes,
  contentLen: snapshot.contentLength,
  sectionLen: snapshot.sectionLength,
  contentFp: snapshot.contentFingerprint,
  sectionFp: snapshot.headingSectionFingerprint,
});

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
    fileSizeBytes: stat?.size ?? -1,
    contentLength: content.length,
    sectionLength: sectionContent.length,
    contentFingerprint: computeContentFingerprint(content),
    headingSectionFingerprint: computeContentFingerprint(sectionContent),
  };
};

export const waitForStableSyncDocumentSnapshot = async (
  vault: Vault,
  file: TFile,
  syncHeading: string,
  tickId?: string,
): Promise<void> => {
  const startedAt = Date.now();
  prepareSyncDocumentDebugLog("waitForStable: start", {
    tickId,
    path: file.path,
    syncHeading,
    pollAttempts: SYNC_DOCUMENT_STABILITY_POLL_ATTEMPTS,
    pollDelayMs: SYNC_DOCUMENT_STABILITY_POLL_DELAY_MS,
  });

  const initialSnapshot = await buildSyncDocumentSnapshot(vault, file, syncHeading);
  if (initialSnapshot === undefined) {
    prepareSyncDocumentDebugError("waitForStable: initial read failed", {
      tickId,
      path: file.path,
    });
    throw new PrepareSyncDocumentError(`Unable to read sync document "${file.path}".`);
  }

  prepareSyncDocumentDebugLog("waitForStable: initial snapshot", {
    tickId,
    ...summariseSnapshot(initialSnapshot),
  });

  let previousSnapshot = initialSnapshot;
  for (let attempt = 1; attempt <= SYNC_DOCUMENT_STABILITY_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) =>
      runtimeSetTimeout(resolve, SYNC_DOCUMENT_STABILITY_POLL_DELAY_MS),
    );
    const currentSnapshot = await buildSyncDocumentSnapshot(vault, file, syncHeading);
    if (currentSnapshot === undefined) {
      prepareSyncDocumentDebugError("waitForStable: poll read failed", {
        tickId,
        path: file.path,
        attempt,
      });
      throw new PrepareSyncDocumentError(`Unable to read sync document "${file.path}".`);
    }

    const contentFpChanged =
      currentSnapshot.contentFingerprint !== previousSnapshot.contentFingerprint;
    const sectionFpChanged =
      currentSnapshot.headingSectionFingerprint !== previousSnapshot.headingSectionFingerprint;
    const fingerprintStable = !contentFpChanged && !sectionFpChanged;
    const mtimeAvailable =
      currentSnapshot.fileMtimeEpochMs >= 0 && previousSnapshot.fileMtimeEpochMs >= 0;
    const mtimeChanged =
      mtimeAvailable && currentSnapshot.fileMtimeEpochMs !== previousSnapshot.fileMtimeEpochMs;
    const mtimeStable = !mtimeAvailable || !mtimeChanged;
    const sizeChanged = currentSnapshot.fileSizeBytes !== previousSnapshot.fileSizeBytes;
    const elapsedMs = Date.now() - startedAt;

    prepareSyncDocumentDebugLog("waitForStable: poll", {
      tickId,
      attempt,
      elapsedMs,
      fingerprintStable,
      mtimeStable,
      contentFpChanged,
      sectionFpChanged,
      mtimeChanged,
      sizeChanged,
      previous: summariseSnapshot(previousSnapshot),
      current: summariseSnapshot(currentSnapshot),
      mtimeDeltaMs: mtimeAvailable
        ? currentSnapshot.fileMtimeEpochMs - previousSnapshot.fileMtimeEpochMs
        : undefined,
      contentLenDelta: currentSnapshot.contentLength - previousSnapshot.contentLength,
      sectionLenDelta: currentSnapshot.sectionLength - previousSnapshot.sectionLength,
    });

    if (fingerprintStable && mtimeStable) {
      prepareSyncDocumentDebugLog("waitForStable: stable", {
        tickId,
        path: file.path,
        attempt,
        elapsedMs,
        final: summariseSnapshot(currentSnapshot),
      });
      return;
    }

    prepareSyncDocumentDebugWarn("waitForStable: still changing", {
      tickId,
      attempt,
      reasons: {
        contentFpChanged,
        sectionFpChanged,
        mtimeChanged,
        sizeChanged,
      },
    });
    previousSnapshot = currentSnapshot;
  }

  prepareSyncDocumentDebugWarn("waitForStable: unstable after budget", {
    tickId,
    path: file.path,
    attempts: SYNC_DOCUMENT_STABILITY_POLL_ATTEMPTS,
    elapsedMs: Date.now() - startedAt,
    last: summariseSnapshot(previousSnapshot),
  });
  throw new UnstableSyncDocumentError();
};

const resolveSyncDocumentFile = async (
  vault: Vault,
  syncDocument: string,
  tickId?: string,
): Promise<TFile | null> => {
  const file = vault.getFileByPath(syncDocument);
  if (file !== null) {
    prepareSyncDocumentDebugLog("resolve: found", { tickId, syncDocument, path: file.path });
    return file;
  }

  prepareSyncDocumentDebugWarn("resolve: missing on first lookup; retrying", {
    tickId,
    syncDocument,
    retryDelayMs: SYNC_DOCUMENT_VAULT_INIT_RETRY_DELAY_MS,
  });
  await new Promise((resolve) =>
    runtimeSetTimeout(resolve, SYNC_DOCUMENT_VAULT_INIT_RETRY_DELAY_MS),
  );
  const retryFile = vault.getFileByPath(syncDocument);
  prepareSyncDocumentDebugLog("resolve: retry result", {
    tickId,
    syncDocument,
    found: retryFile !== null,
  });
  return retryFile;
};

export type PrepareSyncDocumentForRunOptions = {
  vault: Vault;
  syncDocument: string;
  syncHeading: string;
  saveIfDirty?: () => Promise<void>;
  tickId?: string;
};

/**
 * Saves the sync note when open with unsaved edits, then waits until on-disk
 * content is stable before jobs read it.
 */
export const prepareSyncDocumentForRun = async ({
  vault,
  syncDocument,
  syncHeading,
  saveIfDirty,
  tickId = allocatePrepareTickId(),
}: PrepareSyncDocumentForRunOptions): Promise<TFile> => {
  const startedAt = Date.now();
  prepareSyncDocumentDebugLog("prepare: start", {
    tickId,
    syncDocument,
    syncHeading,
    hasSaveIfDirty: saveIfDirty !== undefined,
  });

  if (saveIfDirty !== undefined) {
    const saveStartedAt = Date.now();
    prepareSyncDocumentDebugLog("prepare: saveIfDirty begin", { tickId });
    try {
      await saveIfDirty();
      prepareSyncDocumentDebugLog("prepare: saveIfDirty done", {
        tickId,
        elapsedMs: Date.now() - saveStartedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      prepareSyncDocumentDebugError("prepare: saveIfDirty failed", {
        tickId,
        message,
        elapsedMs: Date.now() - saveStartedAt,
      });
      throw error;
    }
  }

  const file = await resolveSyncDocumentFile(vault, syncDocument, tickId);
  if (file === null) {
    prepareSyncDocumentDebugError("prepare: file not found", { tickId, syncDocument });
    throw new PrepareSyncDocumentError(`Sync document "${syncDocument}" not found.`);
  }

  await waitForStableSyncDocumentSnapshot(vault, file, syncHeading, tickId);
  prepareSyncDocumentDebugLog("prepare: ready", {
    tickId,
    path: file.path,
    elapsedMs: Date.now() - startedAt,
  });
  return file;
};
