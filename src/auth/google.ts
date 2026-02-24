import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URLSearchParams } from "node:url";
import { formatLogError } from "@/utils/error-formatters";
import type { GoogleCredentials, GoogleUserInfo } from "@/auth/types";
import { refreshResponseSchema, googleUserInfoResponseSchema } from "@/auth/schemas";

const SUCCESS_MESSAGE = "Authentication successful! Please return to the console.";

// Google OAuth 2.0 endpoints
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Error thrown when a token refresh fails due to an invalid or expired refresh token.
 * This typically occurs when the OAuth app is in testing mode and tokens expire after 7 days,
 * or when the user has revoked access.
 * @see https://stackoverflow.com/a/67966982
 */
export class InvalidGrantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidGrantError";
    Object.setPrototypeOf(this, InvalidGrantError.prototype);
  }
}

export type AuthOptions = {
  clientId: string;
  scopes: string;
};

type AuthResult = {
  code: string;
  redirectUri: string;
};

type AuthError = {
  type: "authorization_denied" | "missing_code" | "invalid_url";
  message: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

const isAddressInfo = (address: string | AddressInfo | null): address is AddressInfo =>
  typeof address === "object" && address !== null && "port" in address;

const createRedirectUri = (port: number): string => `http://localhost:${port}/`;

/**
 * Generate Google OAuth 2.0 authorization URL
 */
const generateAuthUrl = (clientId: string, redirectUri: string, scopes: string): string => {
  const parameters = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent", // Force refresh token to be returned
  });

  return `${GOOGLE_AUTH_URL}?${parameters.toString()}`;
};

/**
 * Exchange authorization code for tokens
 */
const exchangeCodeForTokens = async (
  clientId: string,
  code: string,
  redirectUri: string,
): Promise<GoogleCredentials> => {
  const parameters = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: parameters.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const json: unknown = await response.json();
  const data = json as TokenResponse;

  if (!data.access_token) {
    throw new Error("No access token received from Google");
  }

  if (typeof data.refresh_token !== "string" || data.refresh_token.length === 0) {
    throw new Error("No refresh token received from Google");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryDate: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
};

const parseAuthRequest = (requestUrl: string, expectedPath: string): AuthResult | AuthError => {
  const url = new URL(requestUrl, "http://localhost:3000");

  if (url.pathname !== expectedPath) {
    return { type: "invalid_url", message: "Invalid callback URL" };
  }

  const searchParameters = url.searchParams;

  if (searchParameters.has("error")) {
    const errorMessage = searchParameters.get("error") ?? "Unknown error";
    return { type: "authorization_denied", message: errorMessage };
  }

  if (!searchParameters.has("code")) {
    return { type: "missing_code", message: "Cannot read authentication code." };
  }

  const code = searchParameters.get("code");
  if (code === null) {
    return { type: "missing_code", message: "Cannot read authentication code." };
  }

  return { code, redirectUri: expectedPath };
};

const handleAuthError = (error: AuthError, response: ServerResponse): void => {
  switch (error.type) {
    case "authorization_denied": {
      response.end("Authorization rejected.");
      break;
    }
    case "missing_code": {
      response.end("No authentication code provided.");
      break;
    }
    case "invalid_url": {
      response.end("Invalid callback URL");
      break;
    }
  }
};

const createAuthServer = (
  clientId: string,
  redirectPath: string,
  getRedirectUri: () => string,
  onSuccess: (credentials: GoogleCredentials) => void,
  onError: (error: Error) => void,
) =>
  createServer(async (request, response) => {
    try {
      const requestUrl = request.url ?? "/";
      const result = parseAuthRequest(requestUrl, redirectPath);

      // Handle success case early
      if (!("type" in result)) {
        const redirectUri = getRedirectUri(); // Get the redirectUri when we need it
        const authenticatedClient = await exchangeCodeForTokens(clientId, result.code, redirectUri);

        response.end(SUCCESS_MESSAGE);
        onSuccess(authenticatedClient);
        return;
      }

      // Handle all error cases
      handleAuthError(result, response);

      // Only reject promise for actual OAuth errors, not invalid URLs
      if (result.type !== "invalid_url") {
        onError(new Error(result.message));
      }
    } catch (error) {
      onError(error as Error);
    }
  });

/**
 * Authenticates with Google OAuth 2.0 using a local HTTP server for callback handling.
 *
 * Creates a temporary HTTP server on an ephemeral port to handle the OAuth callback,
 * opens the Google authorization URL in the user's browser, and exchanges the received
 * authorization code for access and refresh tokens.
 *
 * @param options - Authentication configuration options
 * @param options.clientId - Your Google OAuth 2.0 client ID
 * @param options.scopes - Space-separated string of OAuth scopes to request
 * @returns A Promise that resolves to Google credentials with access/refresh tokens
 * @throws {Error} When the OAuth flow fails, the server cannot start, or the user denies authorization
 *
 * @example
 * ```typescript
 * const credentials = await authenticate({
 *   clientId: "your-client-id.googleusercontent.com",
 *   scopes: "https://www.googleapis.com/auth/tasks openid email profile"
 * });
 *
 * // Credentials now contain access_token, refresh_token, etc.
 * const userInfo = await getUserInfo(credentials.accessToken);
 * ```
 *
 * @remarks
 * - Uses an ephemeral port (0) to avoid conflicts with existing services
 * - Automatically opens the authorization URL in the user's default browser
 * - The temporary server is automatically closed after successful authentication or error
 * - Supports both authorization success and error scenarios (user denial, missing code, etc.)
 * - Forces consent prompt to ensure refresh token is always returned
 */
export const authenticate = async (options: AuthOptions): Promise<GoogleCredentials> =>
  new Promise((resolve, reject) => {
    const redirectPath = "/";
    let serverPort: number; // Store port from server.listen callback

    const getRedirectUri = () => createRedirectUri(serverPort);

    const server = createAuthServer(
      options.clientId,
      redirectPath,
      getRedirectUri,
      (credentials: GoogleCredentials) => {
        server.close();
        resolve(credentials);
      },
      (error: Error) => {
        server.close();
        reject(error);
      },
    );

    server.listen(0, () => {
      const address = server.address();

      if (!isAddressInfo(address)) {
        reject(new Error("Unexpected server address type."));
        return;
      }

      serverPort = address.port;
      const redirectUri = createRedirectUri(serverPort);

      const authUrl = generateAuthUrl(options.clientId, redirectUri, options.scopes);
      window.open(authUrl, "_blank");
    });
  });

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
    const { email } = googleUserInfoResponseSchema.parse(json);
    return {
      email,
    };
  }

  throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
};

// TODO: Let MCP server handle refreshing access tokens

/**
 * Refreshes a Google OAuth 2.0 access token using a refresh token, with retries.
 *
 * @param clientId - Your Google OAuth client ID
 * @param refreshToken - The refresh token issued by Google
 * @param retries - Number of times to retry on network failure (default 2)
 * @returns A Promise resolving to an object containing the new access token and expiry timestamp
 * @throws Error if the refresh fails or the response is invalid
 */
export const refreshAccessToken = async (
  clientId: string,
  refreshToken: string,
  retries = 2,
): Promise<{ accessToken: string; expiryDate: number }> => {
  const parameters = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const attempt = async (
    remainingRetries: number,
  ): Promise<{ accessToken: string; expiryDate: number }> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const response = await fetch(GOOGLE_TOKEN_URL, {
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
          expiryDate: Date.now() + data.expires_in * 1000,
        };
      }

      const text = await response.text();

      // Check for invalid_grant error (token expired or revoked)
      if (response.status === 400) {
        try {
          const errorJson = JSON.parse(text) as { error?: string; error_description?: string };
          if (errorJson.error === "invalid_grant") {
            throw new InvalidGrantError(
              errorJson.error_description ?? "Token has been expired or revoked",
            );
          }
        } catch (parseError) {
          // If it's InvalidGrantError, re-throw it; otherwise parsing failed, fall through to generic error
          if (parseError instanceof InvalidGrantError) {
            throw parseError;
          }
          // If parsing fails, fall through to generic error
        }
      }

      throw new Error(`Failed to refresh token: ${response.status} ${text}`);
    } catch (error) {
      // Don't retry InvalidGrantError - it won't succeed
      if (error instanceof InvalidGrantError) {
        throw error;
      }

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
