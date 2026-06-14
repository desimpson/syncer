/* eslint-disable import/no-nodejs-modules -- OAuth redirect flow requires a local HTTP server */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { requestUrl } from "obsidian";
import { formatLogError } from "@/utils/error-formatters";
import type { MicrosoftCredentials, MicrosoftUserInfo } from "@/auth/types";
import { InvalidGrantError } from "@/auth/google";
import {
  microsoftGraphUserResponseSchema,
  microsoftTokenErrorResponseSchema,
  microsoftTokenResponseSchema,
} from "@/auth/schemas";

const GRAPH_SCOPES =
  "openid profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read";

const SUCCESS_MESSAGE = "Authentication successful. You can close this tab and return to Obsidian.";
const AUTH_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

const authorizeEndpoint = (tenantSegment: string): string =>
  `https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/authorize`;

const tokenEndpoint = (tenantSegment: string): string =>
  `https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/token`;

/**
 * How the user chose to sign in from settings (before OAuth).
 */
export type MicrosoftAuthSelection = {
  accountKind: "personal" | "workSchool";
  /**
   * Azure AD directory (tenant) ID. When `accountKind` is `workSchool`, empty means
   * the special `organizations` tenant (any work or school account).
   */
  workOrSchoolTenantId: string;
};

/**
 * Maps settings UI values to the Microsoft identity platform tenant path segment.
 *
 * - Personal Outlook / MSA → `consumers`
 * - Work or school, any tenant → `organizations`
 * - Work or school, single tenant → Azure AD tenant GUID
 */
export const microsoftGraphTenantSegmentFromAuthSelection = (
  selection: MicrosoftAuthSelection,
): string => {
  if (selection.accountKind === "personal") {
    return "consumers";
  }

  const tenantId = selection.workOrSchoolTenantId.trim();
  return tenantId.length > 0 ? tenantId : "organizations";
};

const isAddressInfo = (address: string | AddressInfo | null): address is AddressInfo =>
  typeof address === "object" && address !== null && "port" in address;

const createRedirectUri = (port: number): string => `http://localhost:${port}/`;

const base64UrlEncode = (buffer: Buffer): string =>
  buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const generatePkcePair = (): { codeVerifier: string; codeChallenge: string } => {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
};

export type MicrosoftAuthOptions = {
  clientId: string;
  /** `consumers`, `organizations`, or a tenant GUID. */
  tenantSegment: string;
};

const parseTokenJson = (text: string): Omit<MicrosoftCredentials, "tenantSegment"> => {
  const json: unknown = JSON.parse(text);
  const data = microsoftTokenResponseSchema.parse(json);

  if (typeof data.refresh_token !== "string" || data.refresh_token.length === 0) {
    throw new Error("No refresh token received from Microsoft");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryDate: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? GRAPH_SCOPES,
  };
};

/**
 * POST form body to a URL via Obsidian's `requestUrl` (avoids renderer `fetch` / CORS issues).
 */
const postForm = async (
  urlString: string,
  formBody: string,
): Promise<{ statusCode: number; body: string }> => {
  const response = await requestUrl({
    url: urlString,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: formBody,
    throw: false,
  });
  return { statusCode: response.status, body: response.text };
};

type AuthResult = {
  code: string;
};

type AuthError = {
  type: "authorization_denied" | "missing_code" | "invalid_url" | "invalid_state";
  message: string;
};

const parseAuthRequest = (
  requestUrlString: string,
  expectedPath: string,
  expectedState: string,
): AuthResult | AuthError => {
  const url = new URL(requestUrlString, "http://localhost:3000");

  if (url.pathname === "/favicon.ico") {
    return { type: "invalid_url", message: "favicon" };
  }

  if (url.pathname !== expectedPath) {
    return { type: "invalid_url", message: "Invalid callback URL" };
  }

  const searchParameters = url.searchParams;

  if (searchParameters.has("error")) {
    const errorMessage =
      searchParameters.get("error_description") ?? searchParameters.get("error") ?? "Unknown error";
    return { type: "authorization_denied", message: errorMessage };
  }

  const state = searchParameters.get("state");
  if (state !== expectedState) {
    return { type: "invalid_state", message: "Invalid OAuth state." };
  }

  const code = searchParameters.get("code");
  if (code === null || code.length === 0) {
    return { type: "missing_code", message: "Cannot read authentication code." };
  }

  return { code };
};

const handleAuthError = (error: AuthError, response: ServerResponse): void => {
  switch (error.type) {
    case "authorization_denied": {
      response.end("Authorization rejected.");
      break;
    }
    case "missing_code":
    case "invalid_state": {
      response.end("Sign-in could not be completed.");
      break;
    }
    case "invalid_url": {
      if (error.message === "favicon") {
        response.statusCode = 404;
      }
      response.end(error.message === "favicon" ? "" : "Invalid callback URL");
      break;
    }
  }
};

const buildAuthorizeUrl = (
  tenantSegment: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string => {
  const parameters = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GRAPH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    prompt: "consent", // Force refresh token on (re)connect; required for offline_access
  });

  return `${authorizeEndpoint(tenantSegment)}?${parameters.toString()}`;
};

const exchangeCodeForTokens = async (
  tenantSegment: string,
  clientId: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<MicrosoftCredentials> => {
  const formBody = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  const { statusCode, body: text } = await postForm(tokenEndpoint(tenantSegment), formBody);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Microsoft token exchange failed: ${statusCode} ${text}`);
  }

  const tokens = parseTokenJson(text);
  return { ...tokens, tenantSegment };
};

const createAuthServer = (
  tenantSegment: string,
  clientId: string,
  redirectPath: string,
  oauthState: string,
  codeVerifier: string,
  getRedirectUri: () => string,
  onSuccess: (credentials: MicrosoftCredentials) => void,
  onError: (error: Error) => void,
) =>
  createServer(async (request, response) => {
    try {
      const requestUrlString = request.url ?? "/";
      const result = parseAuthRequest(requestUrlString, redirectPath, oauthState);

      if (!("type" in result)) {
        const redirectUri = getRedirectUri();
        const credentials = await exchangeCodeForTokens(
          tenantSegment,
          clientId,
          result.code,
          redirectUri,
          codeVerifier,
        );

        response.end(SUCCESS_MESSAGE);
        onSuccess(credentials);
        return;
      }

      handleAuthError(result, response);

      if (result.type === "invalid_url" && result.message === "favicon") {
        return;
      }

      if (result.type !== "invalid_url") {
        onError(new Error(result.message));
      }
    } catch (error) {
      onError(error as Error);
    }
  });

/**
 * OAuth 2.0 authorization code flow with PKCE. Starts a short-lived `localhost` redirect
 * listener, opens the Microsoft sign-in URL in the browser, then exchanges the code for tokens.
 *
 * Register **Mobile and desktop** redirect URIs in Entra for `http://localhost` (loopback);
 * ephemeral ports are accepted for localhost redirects.
 */
export const authenticate = async (options: MicrosoftAuthOptions): Promise<MicrosoftCredentials> =>
  new Promise((resolve, reject) => {
    const trimmedClientId = options.clientId.trim();
    if (trimmedClientId.length === 0) {
      reject(
        new Error(
          "Microsoft application (client) ID is missing. Set MICROSOFT_CLIENT_ID_DEV or MICROSOFT_CLIENT_ID_PROD for your build.",
        ),
      );
      return;
    }

    const tenantSegment = options.tenantSegment.trim();
    if (tenantSegment.length === 0) {
      reject(new Error("Microsoft tenant segment is empty."));
      return;
    }

    const redirectPath = "/";
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const oauthState = base64UrlEncode(randomBytes(16));
    let didSettle = false;

    let serverPort: number;

    const getRedirectUri = (): string => createRedirectUri(serverPort);

    const settleWith = (callback: () => void): void => {
      if (didSettle) {
        return;
      }
      didSettle = true;
      clearTimeout(connectTimeout);
      server.close();
      callback();
    };

    const server = createAuthServer(
      tenantSegment,
      trimmedClientId,
      redirectPath,
      oauthState,
      codeVerifier,
      getRedirectUri,
      (credentials) => {
        settleWith(() => resolve(credentials));
      },
      (error: Error) => {
        settleWith(() => reject(error));
      },
    );

    const connectTimeout = setTimeout(() => {
      settleWith(() =>
        reject(new Error("Microsoft sign-in timed out. Please try connecting again.")),
      );
    }, AUTH_CONNECT_TIMEOUT_MS);

    server.listen(0, () => {
      const address = server.address();

      if (!isAddressInfo(address)) {
        settleWith(() => reject(new Error("Unexpected server address type.")));
        return;
      }

      serverPort = address.port;
      const redirectUri = createRedirectUri(serverPort);

      const authUrl = buildAuthorizeUrl(
        tenantSegment,
        trimmedClientId,
        redirectUri,
        codeChallenge,
        oauthState,
      );
      window.open(authUrl, "_blank");
    });
  });

/**
 * Fetches Microsoft Graph profile for the signed-in user.
 */
export const getUserInfo = async (accessToken: string): Promise<MicrosoftUserInfo> => {
  const response = await requestUrl({
    url: "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch Microsoft user info: ${response.status} ${response.text}`);
  }

  const json: unknown = JSON.parse(response.text);
  const data = microsoftGraphUserResponseSchema.parse(json);
  const email =
    data.mail !== null && data.mail !== undefined && data.mail.length > 0
      ? data.mail
      : data.userPrincipalName;

  return {
    email,
    displayName: data.displayName ?? undefined,
  };
};

/**
 * Refreshes a Microsoft OAuth 2.0 access token using a refresh token, with retries.
 */
export const refreshAccessToken = async (
  clientId: string,
  credentials: Pick<MicrosoftCredentials, "refreshToken" | "tenantSegment">,
  retries = 2,
): Promise<{ accessToken: string; expiryDate: number; refreshToken?: string }> => {
  const tenantSegment = credentials.tenantSegment.trim();
  const parameters = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
  });

  const attempt = async (
    remainingRetries: number,
  ): Promise<{ accessToken: string; expiryDate: number; refreshToken?: string }> => {
    try {
      const formBody = parameters.toString();
      const response = await Promise.race([
        postForm(tokenEndpoint(tenantSegment), formBody),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Microsoft token request timed out.")), 10_000);
        }),
      ]);

      const { statusCode, body: text } = response;

      if (statusCode >= 200 && statusCode < 300) {
        const json: unknown = JSON.parse(text);
        const data = microsoftTokenResponseSchema.parse(json);
        return {
          accessToken: data.access_token,
          expiryDate: Date.now() + data.expires_in * 1000,
          ...(typeof data.refresh_token === "string" && data.refresh_token.length > 0
            ? { refreshToken: data.refresh_token }
            : {}),
        };
      }

      if (statusCode === 400) {
        try {
          const json: unknown = JSON.parse(text);
          const errorJson = microsoftTokenErrorResponseSchema.parse(json);
          if (errorJson.error === "invalid_grant") {
            throw new InvalidGrantError(
              errorJson.error_description ?? "Token has been expired or revoked",
            );
          }
        } catch (parseError) {
          if (parseError instanceof InvalidGrantError) {
            throw parseError;
          }
        }
      }

      throw new Error(`Failed to refresh token: ${statusCode} ${text}`);
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        throw error;
      }

      if (remainingRetries > 0) {
        console.warn(
          `Microsoft token refresh failed; retrying... Retries left: [${remainingRetries}]. Error: [${formatLogError(
            error,
          )}].`,
        );
        await new Promise((r) => setTimeout(r, 1000));
        return attempt(remainingRetries - 1);
      }
      throw new Error(`Microsoft token refresh failed after retries: [${formatLogError(error)}].`);
    }
  };

  return attempt(retries);
};
