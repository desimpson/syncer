import type { SyncAdaptor } from "@/adaptors/types";
import type { GmailStarredMessage } from "@/services/gmail-starred";
import { GMAIL_STARRED_SOURCE } from "@/sync/types";

const GMAIL_ALL_FALLBACK_LINK = "https://mail.google.com/mail/u/0/#all";

const nonEmptyTrimmed = (value: string | null | undefined): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const headerValue = (message: GmailStarredMessage, name: string): string | undefined => {
  const headers = message.payload?.headers ?? [];
  const match = headers.find((header) => header.name.toLowerCase() === name.toLowerCase());
  return nonEmptyTrimmed(match?.value);
};

/**
 * Parses a Gmail `From` header into a display sender string.
 */
export const parseGmailFromHeader = (fromHeader: string | undefined): string => {
  const trimmed = nonEmptyTrimmed(fromHeader);
  if (trimmed === undefined) {
    return "Unknown sender";
  }

  const angleOnlyMatch = /^<([^>]+)>$/.exec(trimmed);
  if (angleOnlyMatch !== null) {
    const address = angleOnlyMatch[1];
    return address === undefined ? trimmed : address.trim();
  }

  const angleBracketMatch = /^(.+?)\s*<([^>]+)>$/.exec(trimmed);
  if (angleBracketMatch !== null) {
    const displayPart = angleBracketMatch[1];
    const addressPart = angleBracketMatch[2];
    if (displayPart !== undefined && addressPart !== undefined) {
      const display = displayPart.replaceAll(/^"|"$/g, "").trim();
      const address = addressPart.trim();
      return display.length > 0 ? display : address;
    }
  }

  return trimmed;
};

const messageTitle = (message: GmailStarredMessage): string => {
  const subject = headerValue(message, "Subject") ?? "(No subject)";
  const sender = parseGmailFromHeader(headerValue(message, "From"));
  return `${subject} (${sender})`;
};

const messageLink = (message: GmailStarredMessage): string => {
  const threadId = nonEmptyTrimmed(message.threadId);
  if (threadId === undefined) {
    return GMAIL_ALL_FALLBACK_LINK;
  }
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
};

/**
 * Maps a starred Gmail message to a `SyncItem` for Markdown sync.
 */
export const mapGmailMessageToSyncItem: SyncAdaptor<GmailStarredMessage> =
  (heading) => (message) => ({
    source: GMAIL_STARRED_SOURCE,
    id: message.id,
    title: messageTitle(message),
    link: messageLink(message),
    heading,
    completed: false,
  });
