import type { SyncAdaptor } from "./types";
import type { GoogleTask } from "@/services/types";

/**
 * Maps a single `GoogleTask` to a generic `SyncItem`.
 *
 * This adaptor is responsible for converting Google Tasks API data
 * into the standardised sync format used by the sync engine.
 *
 * @param heading - The heading under which the item will be synced
 * @returns A function that accepts a `GoogleTask` and returns a `SyncItem`
 * suitable for writing to Markdown
 */
export const mapGoogleTaskToSyncItem: SyncAdaptor<GoogleTask> =
  (heading) =>
  ({ id, title, webViewLink: link }) => ({
    source: "google-tasks",
    id,
    title,
    link,
    heading,
  });
