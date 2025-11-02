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
