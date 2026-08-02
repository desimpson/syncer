import { mapFirefoxBookmarkToSyncItem } from "@/adaptors/firefox-bookmarks";
import type { SyncJobCreator } from "@/jobs/types";
import type { PluginSettings } from "@/plugin/types";
import {
  fetchFirefoxBookmarkFolders,
  fetchFirefoxBookmarks,
  FirefoxBookmarksError,
} from "@/services/firefox-bookmarks";
import { FIREFOX_NOTICE } from "@/services/firefox-messages";
import { filterActions, generateSyncActions, shouldPreserveCompletedDeletes } from "@/sync/actions";
import { readMarkdownSyncItems } from "@/sync/reader";
import { FIREFOX_BOOKMARKS_SOURCE } from "@/sync/types";
import { writeSyncActions } from "@/sync/writer";
import { Platform, type TFile, type Vault } from "obsidian";

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
    notify(FIREFOX_NOTICE.syncDocumentMissing(syncDocument));
    console.warn(`Sync document [${syncDocument}] not found. Aborting Firefox sync.`);
    return undefined;
  }

  return retryFile;
};

const isMissingFileError = (message: string): boolean =>
  /ENOENT|no such file or directory|not found/i.test(message);

const resolveSelectedFolderGuids = async (
  settings: NonNullable<PluginSettings["firefoxBookmarks"]>,
  wasmDirectory: string,
  notify: (message: string) => void,
): Promise<readonly string[]> => {
  const { profilePath, selectedFolderGuids } = settings;
  if (selectedFolderGuids.length === 0) {
    return [];
  }

  const { folders } = await fetchFirefoxBookmarkFolders(profilePath, wasmDirectory);
  const availableGuids = new Set(folders.map((folder) => folder.guid));
  const validGuids = selectedFolderGuids.filter((guid) => availableGuids.has(guid));
  const staleCount = selectedFolderGuids.length - validGuids.length;

  if (staleCount > 0) {
    notify(FIREFOX_NOTICE.staleFolders);
  }

  if (validGuids.length === 0) {
    notify(FIREFOX_NOTICE.noValidFolders);
  }

  return validGuids;
};

/**
 * Create a job to sync Firefox bookmarks into the Markdown sync note.
 */
export const createFirefoxBookmarksJob: SyncJobCreator = (
  loadSettings,
  _saveSettings,
  config,
  vault,
  notify,
) => ({
  name: "firefox-bookmarks",
  task: async () => {
    if (!Platform.isDesktopApp) {
      return;
    }

    const settings = await loadSettings();
    const { firefoxBookmarks, syncDocument, syncHeading } = settings;

    if (firefoxBookmarks === undefined) {
      return;
    }

    const file = await getSyncFileWithRetry(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    try {
      const folderGuids = await resolveSelectedFolderGuids(
        firefoxBookmarks,
        config.pluginDirectory,
        notify,
      );

      if (folderGuids.length === 0) {
        return;
      }

      const { bookmarks, walSidecarsPresent } = await fetchFirefoxBookmarks(
        firefoxBookmarks.profilePath,
        folderGuids,
        config.pluginDirectory,
      );

      if (walSidecarsPresent) {
        notify(FIREFOX_NOTICE.firefoxMayBeOpen);
      }

      const adaptor = mapFirefoxBookmarkToSyncItem(syncHeading);
      const incoming = bookmarks.map(adaptor);

      try {
        const existing = await readMarkdownSyncItems(file, FIREFOX_BOOKMARKS_SOURCE);
        const actions = filterActions(
          generateSyncActions(incoming, existing),
          shouldPreserveCompletedDeletes,
        );
        await writeSyncActions(file, actions, syncHeading);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isMissingFileError(message)) {
          notify(FIREFOX_NOTICE.syncDocumentMissingOnDisk(syncDocument));
          console.error(`File missing during Firefox sync: [${message}]. Aborting sync.`);
          return;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof FirefoxBookmarksError) {
        notify(error.userMessage);
        console.warn(`Firefox bookmarks sync failed: ${error.message}`);
        return;
      }
      throw error;
    }
  },
});
