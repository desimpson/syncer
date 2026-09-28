import { runtimeSetTimeout } from "@/utils/browser-runtime";
import type { TFile, Vault } from "obsidian";

/** Delay before retrying path lookup while Obsidian vault is still initialising. */
export const SYNC_DOCUMENT_VAULT_INIT_RETRY_DELAY_MS = 500;

/** User-facing notice when the configured sync path does not resolve in the vault. */
export const formatSyncDocumentNotFoundNotice = (syncDocument: string): string =>
  `Sync document "${syncDocument}" not found. Please update settings or create the file.`;

/** User-facing notice when the path resolves but the file is missing on disk. */
export const formatSyncDocumentMissingOnDiskNotice = (syncDocument: string): string =>
  `Sync document "${syncDocument}" is missing on disk. Please recreate it or update settings.`;

/** Generic prepare/read failure notice for unexpected vault errors. */
export const formatSyncDocumentPrepareFailureNotice = (
  _syncDocument: string,
  message: string,
): string => `Sync document prepare failed: ${message}`;

/** Whether an error message indicates the sync note file is absent on disk. */
export const isSyncDocumentMissingFileError = (message: string): boolean =>
  /ENOENT|no such file or directory|not found/i.test(message);

/**
 * Resolve the sync document path with one retry for vault initialisation.
 * Does not read file contents; callers probe readability separately when needed.
 */
export const getSyncDocumentWithRetry = async (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<TFile | undefined> => {
  const file = vault.getFileByPath(syncDocument);
  if (file !== null) {
    return file;
  }

  await new Promise((resolve) =>
    runtimeSetTimeout(resolve, SYNC_DOCUMENT_VAULT_INIT_RETRY_DELAY_MS),
  );
  const retryFile = vault.getFileByPath(syncDocument);

  if (retryFile === null) {
    notify(formatSyncDocumentNotFoundNotice(syncDocument));
    console.warn(`Sync document [${syncDocument}] not found. Aborting sync.`);
    return undefined;
  }

  return retryFile;
};

/**
 * Resolve the sync document and prove it is readable via `vault.read` before network I/O.
 * Does not fall back to `cachedRead`; stale metadata cache handles are treated as missing.
 */
export const resolveReadableSyncDocument = async (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<TFile | undefined> => {
  const file = await getSyncDocumentWithRetry(vault, syncDocument, notify);
  if (file === undefined) {
    return undefined;
  }

  try {
    await vault.read(file);
    return file;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSyncDocumentMissingFileError(message)) {
      notify(formatSyncDocumentMissingOnDiskNotice(syncDocument));
      console.error(`File missing during sync: [${message}]. Aborting sync.`);
      return undefined;
    }
    notify(formatSyncDocumentPrepareFailureNotice(syncDocument, message));
    console.warn(`Sync document prepare failed: [${message}]. Aborting sync.`);
    return undefined;
  }
};

/**
 * When a job error may follow a deleted sync note, probe `vault.read` and notify if unavailable.
 *
 * @returns true when a notice was shown and the caller should return without rethrowing
 */
export const notifyIfSyncDocumentUnavailable = async (
  vault: Vault,
  syncDocument: string,
  notify: (message: string) => void,
): Promise<boolean> => {
  const file = vault.getFileByPath(syncDocument);
  if (file === null) {
    notify(formatSyncDocumentNotFoundNotice(syncDocument));
    console.warn(`Sync document [${syncDocument}] not found. Aborting sync.`);
    return true;
  }

  try {
    await vault.read(file);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSyncDocumentMissingFileError(message)) {
      notify(formatSyncDocumentMissingOnDiskNotice(syncDocument));
      console.error(`File missing during sync: [${message}]. Aborting sync.`);
      return true;
    }
    notify(formatSyncDocumentPrepareFailureNotice(syncDocument, message));
    console.warn(`Sync document prepare failed: [${message}]. Aborting sync.`);
    return true;
  }
};
