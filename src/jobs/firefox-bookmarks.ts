import { mapFirefoxBookmarkToSyncItem } from "@/adaptors/firefox-bookmarks";
import type { SyncJobCreator } from "@/jobs/types";
import type { PluginSettings } from "@/plugin/types";
import { fetchFirefoxBookmarks, FirefoxBookmarksError } from "@/services/firefox-bookmarks";
import { FIREFOX_NOTICE } from "@/services/firefox-messages";
import { shouldPreserveCompletedDeletes } from "@/sync/actions";
import { FIREFOX_BOOKMARKS_SOURCE } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import {
  notifyIfSyncDocumentUnavailable,
  resolveReadableSyncDocument,
} from "@/sync/resolve-sync-document";
import { Platform } from "obsidian";

/**
 * Validate selected folders against the last Refresh folders snapshot (settings),
 * so sync opens places.sqlite only once for bookmark fetch.
 */
const resolveSelectedFolderGuids = (
  settings: NonNullable<PluginSettings["firefoxBookmarks"]>,
  notify: (message: string) => void,
): readonly string[] => {
  const { selectedFolderGuids, availableFolders } = settings;
  if (selectedFolderGuids.length === 0) {
    return [];
  }

  const availableGuids = new Set(availableFolders.map((folder) => folder.guid));
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

    const file = await resolveReadableSyncDocument(vault, syncDocument, notify);
    if (file === undefined) {
      return;
    }

    try {
      const folderGuids = resolveSelectedFolderGuids(firefoxBookmarks, notify);

      if (folderGuids.length === 0) {
        return;
      }

      const { bookmarks, walSidecarsPresent, walMerged } = await fetchFirefoxBookmarks(
        firefoxBookmarks.profilePath,
        folderGuids,
        config.pluginDirectory,
      );

      if (walSidecarsPresent && !walMerged) {
        notify(FIREFOX_NOTICE.firefoxWalNotMerged);
      }
      const adaptor = mapFirefoxBookmarkToSyncItem(syncHeading);
      const incoming = bookmarks.map(adaptor);

      try {
        await reconcileSyncSourceAtomically(
          file,
          incoming,
          FIREFOX_BOOKMARKS_SOURCE,
          syncHeading,
          shouldPreserveCompletedDeletes,
        );
      } catch (error) {
        if (await notifyIfSyncDocumentUnavailable(vault, syncDocument, notify)) {
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
      if (await notifyIfSyncDocumentUnavailable(vault, syncDocument, notify)) {
        return;
      }
      throw error;
    }
  },
});
