import type { SyncAdaptor } from "./types";
import type { OutlookFlaggedMessage } from "@/services/outlook-mail";
import { MICROSOFT_OUTLOOK_SOURCE } from "@/sync/types";

const nonEmptyTrimmed = (value: string | null | undefined): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const formatSender = (message: OutlookFlaggedMessage): string =>
  nonEmptyTrimmed(message.from?.emailAddress?.name) ??
  nonEmptyTrimmed(message.from?.emailAddress?.address) ??
  "Unknown sender";

const messageTitle = (message: OutlookFlaggedMessage): string => {
  const subject = nonEmptyTrimmed(message.subject) ?? "(No subject)";
  return `${subject} (${formatSender(message)})`;
};

const messageLink = (message: OutlookFlaggedMessage): string =>
  nonEmptyTrimmed(message.webLink) ?? "https://outlook.office.com/mail/";

/**
 * Maps a flagged Graph message to a `SyncItem` for Markdown sync.
 */
export const mapOutlookMessageToSyncItem: SyncAdaptor<OutlookFlaggedMessage> =
  (heading) => (message) => ({
    source: MICROSOFT_OUTLOOK_SOURCE,
    id: message.id,
    title: messageTitle(message),
    link: messageLink(message),
    heading,
    completed: false,
  });
