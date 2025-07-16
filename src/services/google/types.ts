import type { z } from "zod";
import type {
  googleTaskSchema,
  googleTasksListSchema,
  googleUserInfoResponseSchema,
} from "./schemas";

/**
 * Google OAuth 2.0 tokens.
 */
export type AccessToken = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // Unix timestamp in milliseconds
};

type GoogleUserInfoResponse = z.infer<typeof googleUserInfoResponseSchema>;

/**
 * Google user information with `userId` instead of `sub`.
 */
export type GoogleUserInfo = Omit<GoogleUserInfoResponse, "sub"> & {
  userId: GoogleUserInfoResponse["sub"];
};

/**
 * Refreshed Google OAuth 2.0 access token without a new refresh token.
 */
export type RefreshedAccessToken = Omit<AccessToken, "refreshToken">;

/** A Google Tasks list entity (id + title). */
export type GoogleTasksList = z.infer<typeof googleTasksListSchema>;

/** A single Google Task item. */
export type GoogleTask = z.infer<typeof googleTaskSchema>;
