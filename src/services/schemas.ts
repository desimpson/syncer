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
  webViewLink: z.string().url(),
});

/** Schema for the Google Tasks items response payload. */
export const googleTasksResponseSchema = z.object({
  items: z.array(googleTaskSchema),
});
