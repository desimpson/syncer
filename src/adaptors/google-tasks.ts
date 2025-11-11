import type { SyncAdaptor } from "./types";
import type { GoogleTask } from "@/services/types";

/**
 * Maps a single `GoogleTask` to a generic `SyncItem`.
 *
 * This adaptor is responsible for converting Google Tasks API data
 * into the standardised sync format used by the sync engine.
 *
 * @param heading - The heading under which the item will be synced
 * @param task - A `GoogleTask` object returned from the Google Tasks API
 * @returns A `SyncItem` suitable for writing to Markdown
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
