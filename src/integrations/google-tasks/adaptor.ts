import type { GoogleTask } from "@/services/google/types";
import type { SyncAdaptor } from "@/integrations/types";
import { GOOGLE_TASKS_SOURCE } from "@/integrations/google-tasks/constants";

/**
 * Maps a single `GoogleTask` to a generic `SyncItem`.
 *
 * @param heading - The heading under which the item will be synced
 * @param task - A `GoogleTask` object returned from the Google Tasks API
 * @returns A `SyncItem` suitable for writing to Markdown
 */
export const mapGoogleTaskToSyncItem: SyncAdaptor<GoogleTask> =
  (heading) =>
  ({ id, title, webViewLink: link }) => ({
    source: GOOGLE_TASKS_SOURCE,
    id,
    title,
    link,
    heading,
  });
