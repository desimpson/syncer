import { z } from "zod";

/**
 * Schema for validating the response from Google's OAuth 2.0 token endpoint.
 */
export const googleOAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

// --- Google Tasks Schemas ---

/** Schema for a Google Tasks list item. */
export const googleTasksListSchema = z.object({
  id: z.string(),
  title: z.string(),
});

/** Schema for the Google Tasks lists response payload. */
export const googleTasksListsResponseSchema = z.object({
  items: z.array(googleTasksListSchema),
  nextPageToken: z.string().optional(),
});

/** Schema for a single Google Task item. */
export const googleTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  webViewLink: z.url(),
  status: z.enum(["needsAction", "completed"]).optional(),
  completed: z.iso.datetime().optional().nullable(),
});

/** Schema for the Google Tasks items response payload. */
export const googleTasksResponseSchema = z.object({
  items: z.array(googleTaskSchema),
});

// --- Microsoft To Do Schemas ---

/** Schema for a Microsoft To Do list item. */
export const microsoftToDoListSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

/** Schema for a paginated Microsoft To Do lists response. */
export const microsoftToDoListsPageSchema = z.object({
  value: z.array(microsoftToDoListSchema),
  "@odata.nextLink": z.string().optional(),
});

const microsoftToDoTaskStatuses = [
  "notStarted",
  "inProgress",
  "completed",
  "waitingOnOthers",
  "deferred",
] as const;

/** Schema for a Microsoft To Do task item. */
export const microsoftToDoTaskSchema = z.object({
  id: z.string(),
  title: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : "(Untitled)";
    }),
  status: z.string().transform((value) => {
    for (const status of microsoftToDoTaskStatuses) {
      if (value === status) {
        return status;
      }
    }
    return "notStarted";
  }),
});

/** Schema for a paginated Microsoft To Do tasks response. */
export const microsoftToDoTasksPageSchema = z.object({
  value: z.array(microsoftToDoTaskSchema),
  "@odata.nextLink": z.string().optional(),
});
