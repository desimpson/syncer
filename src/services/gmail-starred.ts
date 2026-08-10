import { requestUrl } from "obsidian";
import { z } from "zod";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Default kept after sorting by internalDate within the candidate window. */
export const GMAIL_STARRED_MAX_MESSAGES = 100;

/** Max list ids / metadata gets per sync cycle (2 × MAX). */
export const GMAIL_STARRED_CANDIDATE_LIMIT = 200;

const gmailMessageListEntrySchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

const gmailMessageListResponseSchema = z.object({
  messages: z.array(gmailMessageListEntrySchema).optional().default([]),
  nextPageToken: z.string().optional(),
});

const gmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
});

const gmailMessageMetadataSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z.array(gmailHeaderSchema).optional().default([]),
    })
    .optional(),
});

export type GmailStarredMessage = z.infer<typeof gmailMessageMetadataSchema>;

export type FetchStarredMessagesResult = {
  readonly messages: readonly GmailStarredMessage[];
  readonly truncated: boolean;
};

export class GmailAuthorizationError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "GmailAuthorizationError";
    this.status = status;
  }
}

export class GmailRateLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GmailRateLimitError";
  }
}

const isGmailAuthorizationStatus = (status: number): boolean => status === 401 || status === 403;

const isGmailRateLimitStatus = (status: number): boolean => status === 429;

const throwGmailResponseError = (
  operation: string,
  status: number,
  responseText: string,
): never => {
  const message = `Gmail ${operation} failed: ${status} ${responseText}`;
  if (isGmailAuthorizationStatus(status)) {
    throw new GmailAuthorizationError(status, message);
  }
  if (isGmailRateLimitStatus(status)) {
    throw new GmailRateLimitError(message);
  }
  throw new Error(message);
};

const buildStarredListUrl = (pageToken?: string): string => {
  const parameters = new URLSearchParams({
    labelIds: "STARRED",
    maxResults: "100",
  });
  if (pageToken !== undefined && pageToken.length > 0) {
    parameters.set("pageToken", pageToken);
  }
  return `${GMAIL_API_BASE}/messages?${parameters.toString()}`;
};

const buildMessageMetadataUrl = (messageId: string): string => {
  const parameters = new URLSearchParams({
    format: "metadata",
    metadataHeaders: "Subject",
  });
  parameters.append("metadataHeaders", "From");
  return `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}?${parameters.toString()}`;
};

const gmailRequest = async (
  accessToken: string,
  url: string,
  operation: string,
  options: { method?: string; body?: string } = {},
): Promise<string> => {
  const method = options.method ?? "GET";
  const headers =
    options.body === undefined
      ? { Authorization: `Bearer ${accessToken}` }
      : {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        };

  const response = await requestUrl(
    options.body === undefined
      ? { url, method, headers, throw: false }
      : { url, method, headers, body: options.body, throw: false },
  );

  if (response.status < 200 || response.status >= 300) {
    throwGmailResponseError(operation, response.status, response.text);
  }

  return response.text;
};

const parseMessageListPage = (
  responseText: string,
): z.infer<typeof gmailMessageListResponseSchema> =>
  gmailMessageListResponseSchema.parse(JSON.parse(responseText) as unknown);

const parseMessageMetadata = (responseText: string): GmailStarredMessage =>
  gmailMessageMetadataSchema.parse(JSON.parse(responseText) as unknown);

const resolveCandidateLimit = (maxMessages: number): number => {
  const normalisedMax = Math.max(1, maxMessages);
  return Math.min(GMAIL_STARRED_CANDIDATE_LIMIT, normalisedMax * 2);
};

const collectStarredCandidateIds = async (
  accessToken: string,
  candidateLimit: number,
): Promise<{ readonly candidateIds: readonly string[]; readonly listExhausted: boolean }> => {
  const candidateIds: string[] = [];
  let pageToken: string | undefined;
  let listExhausted = true;

  while (candidateIds.length < candidateLimit) {
    const responseText = await gmailRequest(
      accessToken,
      buildStarredListUrl(pageToken),
      "list messages",
    );
    const page = parseMessageListPage(responseText);

    for (const entry of page.messages) {
      candidateIds.push(entry.id);
      if (candidateIds.length >= candidateLimit) {
        break;
      }
    }

    if (page.nextPageToken === undefined || page.nextPageToken.length === 0) {
      listExhausted = true;
      break;
    }

    if (candidateIds.length >= candidateLimit) {
      listExhausted = false;
      break;
    }

    pageToken = page.nextPageToken;
  }

  return { candidateIds, listExhausted };
};

const fetchMessageMetadata = async (
  accessToken: string,
  messageId: string,
): Promise<GmailStarredMessage> => {
  const responseText = await gmailRequest(
    accessToken,
    buildMessageMetadataUrl(messageId),
    "get message metadata",
  );
  return parseMessageMetadata(responseText);
};

const compareMessagesByRecency = (
  left: GmailStarredMessage,
  right: GmailStarredMessage,
): number => {
  const leftDate = BigInt(left.internalDate ?? "0");
  const rightDate = BigInt(right.internalDate ?? "0");
  if (leftDate !== rightDate) {
    return leftDate > rightDate ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
};

/**
 * Fetches starred Gmail messages using a bounded lookahead window, then keeps
 * the newest messages by internalDate within that window.
 */
export const fetchStarredMessages = async (
  accessToken: string,
  maxMessages = GMAIL_STARRED_MAX_MESSAGES,
): Promise<FetchStarredMessagesResult> => {
  const candidateLimit = resolveCandidateLimit(maxMessages);
  const { candidateIds, listExhausted } = await collectStarredCandidateIds(
    accessToken,
    candidateLimit,
  );

  const messages: GmailStarredMessage[] = [];
  for (const messageId of candidateIds) {
    messages.push(await fetchMessageMetadata(accessToken, messageId));
  }

  // ES2021 lib has no Array#toSorted; copy then sort in place.
  const sortedMessages = [...messages];

  sortedMessages.sort(compareMessagesByRecency);
  const keptMessages = sortedMessages.slice(0, maxMessages);
  const truncated = !listExhausted || candidateIds.length > maxMessages;

  return { messages: keptMessages, truncated };
};

/**
 * Adds or removes the STARRED label for completion sync write-back.
 */
export const updateGmailMessageStarred = async (
  accessToken: string,
  messageId: string,
  starred: boolean,
): Promise<void> => {
  const url = `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}/modify`;
  const body = starred
    ? JSON.stringify({ addLabelIds: ["STARRED"] })
    : JSON.stringify({ removeLabelIds: ["STARRED"] });

  await gmailRequest(accessToken, url, "modify message labels", {
    method: "POST",
    body,
  });
};
