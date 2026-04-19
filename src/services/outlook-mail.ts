import { requestUrl } from "obsidian";
import { z } from "zod";

const GRAPH_MESSAGES_BASE = "https://graph.microsoft.com/v1.0/me/messages";

const outlookMessageSchema = z.object({
  id: z.string(),
  subject: z.string().nullable().optional(),
  webLink: z.string().nullable().optional(),
  from: z
    .object({
      emailAddress: z
        .object({
          name: z.string().nullable().optional(),
          address: z.string().nullable().optional(),
        })
        .optional(),
    })
    .nullable()
    .optional(),
});

const outlookMessagesPageSchema = z.object({
  value: z.array(outlookMessageSchema),
  "@odata.nextLink": z.string().optional(),
});

export type OutlookFlaggedMessage = z.infer<typeof outlookMessageSchema>;

const buildFlaggedMessagesUrl = (): string => {
  const filter = encodeURIComponent("flag/flagStatus eq 'flagged'");
  const select = encodeURIComponent("id,subject,from,webLink,flag");
  return `${GRAPH_MESSAGES_BASE}?$filter=${filter}&$select=${select}&$top=50`;
};

/**
 * Fetches all messages whose Outlook follow-up flag is `flagged` (not yet complete),
 * following Graph `@odata.nextLink` pagination.
 */
export const fetchFlaggedMessages = async (
  accessToken: string,
): Promise<readonly OutlookFlaggedMessage[]> => {
  const collected: OutlookFlaggedMessage[] = [];
  let url: string | undefined = buildFlaggedMessagesUrl();

  while (url !== undefined) {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Microsoft Graph list messages failed: ${response.status} ${response.text}`);
    }

    const json: unknown = JSON.parse(response.text);
    const page = outlookMessagesPageSchema.parse(json);
    collected.push(...page.value);
    url = page["@odata.nextLink"];
  }

  return collected;
};

/**
 * Updates the Outlook flag on a message (`complete` vs `flagged`) for Obsidian completion sync.
 */
export const updateOutlookMessageFlag = async (
  accessToken: string,
  messageId: string,
  completed: boolean,
): Promise<void> => {
  const url = `${GRAPH_MESSAGES_BASE}/${encodeURIComponent(messageId)}`;
  const body = JSON.stringify({
    flag: { flagStatus: completed ? "complete" : "flagged" },
  });

  const response = await requestUrl({
    url,
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body,
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Microsoft Graph PATCH message failed: ${response.status} ${response.text}`);
  }
};
