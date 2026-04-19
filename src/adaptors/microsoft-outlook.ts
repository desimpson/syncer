import type { SyncAdaptor } from "./types";
import type { OutlookFlaggedMessage } from "@/services/outlook-mail";
import { MICROSOFT_OUTLOOK_SOURCE } from "@/sync/types";

const formatSender = (message: OutlookFlaggedMessage): string => {
  const address = message.from?.emailAddress;
  const name = address?.name;
  if (typeof name === "string" && name.length > 0) {
    return name;
  }
  const addr = address?.address;
  if (typeof addr === "string" && addr.length > 0) {
    return addr;
  }
  return "Unknown sender";
};

const messageTitle = (message: OutlookFlaggedMessage): string => {
  const subject =
    message.subject !== undefined && message.subject !== null && message.subject.trim().length > 0
      ? message.subject.trim()
      : "(No subject)";
  return `${subject} (${formatSender(message)})`;
};

const messageLink = (message: OutlookFlaggedMessage): string => {
  if (
    message.webLink !== undefined &&
    message.webLink !== null &&
    message.webLink.trim().length > 0
  ) {
    return message.webLink.trim();
  }
  return "https://outlook.office.com/mail/";
};

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
