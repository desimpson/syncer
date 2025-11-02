import { z } from "zod";

/**
 * Schema for validating the response from Google's user info endpoint.
 */

export const googleUserInfoResponseSchema = z.object({
  email: z.email(),
});

/**
 * Schema for validating the response from Google's token refresh endpoint.
 */
export const refreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

export const googleCredentialsSchema = z.object({
  access_token: z.string().nonempty(), // not null/undefined and not empty
  refresh_token: z.string().nonempty(),
  expiry_date: z.number(),
  scope: z.string().nonempty(),
});
