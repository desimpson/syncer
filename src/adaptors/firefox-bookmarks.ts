import type { SyncAdaptor } from "./types";
import type { FirefoxBookmark } from "@/services/firefox-bookmarks";
import { FIREFOX_BOOKMARKS_SOURCE } from "@/sync/types";

/**
 * Maps a Firefox bookmark to a `SyncItem` for Markdown sync.
 */
export const mapFirefoxBookmarkToSyncItem: SyncAdaptor<FirefoxBookmark> =
  (heading) =>
  ({ guid, title, url }) => ({
    source: FIREFOX_BOOKMARKS_SOURCE,
    id: guid,
    title,
    link: url,
    heading,
    completed: false,
  });
