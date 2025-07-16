import { URLSearchParams } from "node:url";
import { formatLogError } from "@/utils/error-formatters";
import { generateCodeVerifier, generateS256CodeChallenge } from "@/utils/crypto";
import type { AccessToken, GoogleUserInfo, RefreshedAccessToken } from "./types";
import {
  googleOAuthTokenResponseSchema,
  googleUserInfoResponseSchema,
  refreshResponseSchema,
} from "./schemas";

const redirectUri = "urn:ietf:wg:oauth:2.0:oob";

/**
 * Fetches Google user information such as email and user ID using the provided
 * access token.
 *
 * @param accessToken - A valid OAuth 2.0 access token for the Google API
 * @returns A Promise resolving to the parsed Google user information object
 * @throws Throws an error if the HTTP request fails or if the response does not
 *         conform to the expected schema
 */
export const getUserInfo = async (accessToken: string): Promise<GoogleUserInfo> => {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.ok) {
    const json: unknown = await response.json();
    const { sub: userId, email } = googleUserInfoResponseSchema.parse(json);
    return {
      userId,
      email,
    };
  }

  throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
};

/**
 * Creates a Google OAuth 2.0 authorisation URL with the specified scopes.
 *
 * @param googleClientId - The Google Client ID for the application
 * @param scopes - A space-separated list of scopes to request access to
 * @returns An object containing the authorisation URL and a code verifier for
 *          PKCE
 *
 * @see [OAuth 2.0 for Mobile & Desktop Apps – Sample Authorisation URLs](https://developers.google.com/identity/protocols/oauth2/native-app#exchange-authorization-code)
 */
export const createOAuthUrl = async (
  googleClientId: string,
  scopes: string,
): Promise<{ authUrl: string; codeVerifier: string }> => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateS256CodeChallenge(codeVerifier);

  const parameters = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  return {
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`,
    codeVerifier,
  };
};

/**
 * Exchanges an OAuth 2.0 authorisation code for access and refresh tokens.
 *
 * @param googleClientId - The Google Client ID for the application
 * @param googleClientSecret - The Google Client Secret for the application
 * @param code - The authorisation code received from the OAuth 2.0 server
 * @param codeVerifier - The code verifier used in the initial authorisation request
 * @returns A Promise resolving to the validated OAuth token response
 * @throws An error if the HTTP request fails or the response cannot be validated
 */
export const exchangeOAuthCode = async (
  googleClientId: string,
  googleClientSecret: string,
  code: string,
  codeVerifier: string,
): Promise<AccessToken> => {
  const body = new URLSearchParams({
    client_id: googleClientId,
    client_secret: googleClientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (response.ok) {
    const json: unknown = await response.json();
    const { access_token, refresh_token, expires_in } = googleOAuthTokenResponseSchema.parse(json);
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
    };
  }

  throw new Error(`Failed to submit OAuth code: ${response.status} ${response.statusText}`);
};

/**
 * Refreshes a Google OAuth 2.0 access token using a refresh token, with retries.
 *
 * @param clientId - Your Google OAuth client ID
 * @param clientSecret - Your Google OAuth client secret
 * @param refreshToken - The refresh token issued by Google
 * @param retries - Number of times to retry on network failure (default 2)
 * @returns A Promise resolving to an object containing the new access token and expiry timestamp
 * @throws Error if the refresh fails or the response is invalid
 */
export const refreshAccessToken = async (
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  retries = 2,
): Promise<RefreshedAccessToken> => {
  const parameters = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const attempt = async (remainingRetries: number): Promise<RefreshedAccessToken> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: parameters.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const json: unknown = await response.json();
        const data = refreshResponseSchema.parse(json);
        return {
          accessToken: data.access_token,
          expiresIn: data.expires_in,
        };
      }

      const text = await response.text();
      throw new Error(`Failed to refresh token: ${response.status} ${text}`);
    } catch (error) {
      if (remainingRetries > 0) {
        console.warn(
          `Token refresh failed; retrying... Retries left: [${remainingRetries}]. Error: [${formatLogError(
            error,
          )}].`,
        );
        await new Promise((r) => setTimeout(r, 1000)); // small delay before retry
        return attempt(remainingRetries - 1);
      }
      throw new Error(`Token refresh failed after retries: [${formatLogError(error)}].`);
    }
  };

  return attempt(retries);
};
