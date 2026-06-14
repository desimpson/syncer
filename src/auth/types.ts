/**
 * Google user information (just `email`).
 */
export type GoogleUserInfo = {
  email: string;
};

/**
 * Google OAuth 2.0 tokens.
 */
export type GoogleAccessToken = {
  accessToken: string;
  refreshToken: string;
  expiryDate: number; // Unix timestamp in milliseconds
};

export type GoogleCredentials = {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
};

/**
 * Microsoft Graph profile fields used in settings UI.
 */
export type MicrosoftUserInfo = {
  email: string;
  displayName?: string | undefined;
};

/**
 * Microsoft OAuth tokens plus the login authority segment used for refresh
 * (`consumers`, `organizations`, or a directory tenant GUID).
 */
export type MicrosoftCredentials = {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  tenantSegment: string;
};
