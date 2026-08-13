import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { requestUrl } from "obsidian";
import { runtimeClearTimeout, runtimeOpen, runtimeSetTimeout } from "@/utils/browser-runtime";
import { formatLogError } from "@/utils/error-formatters";
import type { TodoistCredentials, TodoistUserInfo } from "@/auth/types";
import { InvalidGrantError } from "@/auth/google";
import {
  todoistTokenErrorResponseSchema,
  todoistTokenResponseSchema,
  todoistUserResponseSchema,
} from "@/auth/schemas";

export const TODOIST_OAUTH_AUTHORIZE_URL = "https://app.todoist.com/oauth/authorize";
export const TODOIST_OAUTH_TOKEN_URL = "https://api.todoist.com/oauth/access_token";
export const TODOIST_OAUTH_SCOPES = "data:read_write";
export const TODOIST_OAUTH_REDIRECT_PORTS = [27_855, 27_856, 27_857] as const;

const SUCCESS_MESSAGE = "Authentication successful. You can close this tab and return to Obsidian.";
const AUTH_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

export type TodoistAuthOptions = {
  clientId: string;
};

const base64UrlEncode = (buffer: Buffer): string =>
  buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const generatePkcePair = (): { codeVerifier: string; codeChallenge: string } => {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
};

const createRedirectUri = (port: number): string => `http://localhost:${port}/`;

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

const parseTokenJson = (text: string, requestedScopes: string): TodoistCredentials => {
  const json: unknown = JSON.parse(text);
  const data = todoistTokenResponseSchema.parse(json);

  if (typeof data.refresh_token !== "string" || data.refresh_token.length === 0) {
    throw new Error("No refresh token received from Todoist");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryDate: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? requestedScopes,
  };
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
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string => {
  const parameters = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: TODOIST_OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return `${TODOIST_OAUTH_AUTHORIZE_URL}?${parameters.toString()}`;
};

const exchangeCodeForTokens = async (
  clientId: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TodoistCredentials> => {
  const formBody = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  const { statusCode, body: text } = await postForm(TODOIST_OAUTH_TOKEN_URL, formBody);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Todoist token exchange failed: ${statusCode} ${text}`);
  }

  return parseTokenJson(text, TODOIST_OAUTH_SCOPES);
};

const listenOnFirstAvailablePort = (
  server: ReturnType<typeof createServer>,
  ports: readonly number[],
): Promise<number> =>
  new Promise((resolve, reject) => {
    const tryPort = (index: number): void => {
      if (index >= ports.length) {
        reject(
          new Error(
            "All Todoist OAuth redirect ports are in use. Close other apps using ports 27855–27857 and try again.",
          ),
        );
        return;
      }

      const port = ports[index] ?? ports[0];
      if (port === undefined) {
        reject(new Error("No Todoist OAuth redirect ports configured."));
        return;
      }

      const onError = (error: NodeJS.ErrnoException): void => {
        if (error.code === "EADDRINUSE") {
          server.removeListener("error", onError);
          tryPort(index + 1);
          return;
        }
        reject(error);
      };

      server.once("error", onError);
      server.listen(port, () => {
        server.removeListener("error", onError);
        resolve(port);
      });
    };

    tryPort(0);
  });

const createAuthServer = (
  clientId: string,
  redirectPath: string,
  oauthState: string,
  codeVerifier: string,
  getRedirectUri: () => string,
  onSuccess: (credentials: TodoistCredentials) => void,
  onError: (error: Error) => void,
) =>
  createServer((request, response) => {
    void (async () => {
      try {
        const requestUrlString = request.url ?? "/";
        const result = parseAuthRequest(requestUrlString, redirectPath, oauthState);

        if (!("type" in result)) {
          const redirectUri = getRedirectUri();
          const credentials = await exchangeCodeForTokens(
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
    })();
  });

/**
 * OAuth 2.0 authorization code flow with PKCE for Todoist public clients.
 * Tries fixed loopback redirect ports registered on the maintainer Todoist app.
 */
export const authenticate = async (options: TodoistAuthOptions): Promise<TodoistCredentials> =>
  new Promise((resolve, reject) => {
    const trimmedClientId = options.clientId.trim();
    if (trimmedClientId.length === 0) {
      reject(
        new Error(
          "Todoist client ID is missing. Set TODOIST_CLIENT_ID_DEV or TODOIST_CLIENT_ID_PROD for your build.",
        ),
      );
      return;
    }

    const redirectPath = "/";
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const oauthState = base64UrlEncode(randomBytes(16));
    let didSettle = false;
    let serverPort: number = TODOIST_OAUTH_REDIRECT_PORTS[0] ?? 27_855;

    const getRedirectUri = (): string => createRedirectUri(serverPort);

    const settleWith = (callback: () => void): void => {
      if (didSettle) {
        return;
      }
      didSettle = true;
      runtimeClearTimeout(connectTimeout);
      server.close();
      callback();
    };

    const server = createAuthServer(
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

    const connectTimeout = runtimeSetTimeout(() => {
      settleWith(() =>
        reject(new Error("Todoist sign-in timed out. Please try connecting again.")),
      );
    }, AUTH_CONNECT_TIMEOUT_MS);

    void listenOnFirstAvailablePort(server, TODOIST_OAUTH_REDIRECT_PORTS)
      .then((port) => {
        serverPort = port;
        const redirectUri = createRedirectUri(serverPort);
        const authUrl = buildAuthorizeUrl(trimmedClientId, redirectUri, codeChallenge, oauthState);
        runtimeOpen(authUrl, "_blank");
      })
      .catch((error: unknown) => {
        settleWith(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
  });

/**
 * Fetches Todoist profile for the signed-in user.
 */
export const getUserInfo = async (accessToken: string): Promise<TodoistUserInfo> => {
  const response = await requestUrl({
    url: "https://api.todoist.com/api/v1/user",
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch Todoist user info: ${response.status} ${response.text}`);
  }

  const json: unknown = JSON.parse(response.text);
  const data = todoistUserResponseSchema.parse(json);

  return {
    email: data.email,
    displayName: data.full_name.length > 0 ? data.full_name : undefined,
  };
};

/**
 * Refreshes a Todoist OAuth 2.0 access token using a refresh token.
 */
export const refreshAccessToken = async (
  clientId: string,
  credentials: Pick<TodoistCredentials, "refreshToken">,
  retries = 2,
): Promise<{ accessToken: string; expiryDate: number; refreshToken?: string }> => {
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
        postForm(TODOIST_OAUTH_TOKEN_URL, formBody),
        new Promise<never>((_, reject) => {
          runtimeSetTimeout(() => reject(new Error("Todoist token request timed out.")), 10_000);
        }),
      ]);

      const { statusCode, body: text } = response;

      if (statusCode >= 200 && statusCode < 300) {
        const json: unknown = JSON.parse(text);
        const data = todoistTokenResponseSchema.parse(json);
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
          const errorJson = todoistTokenErrorResponseSchema.parse(json);
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

      throw new Error(`Failed to refresh Todoist token: ${statusCode} ${text}`);
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        throw error;
      }

      if (remainingRetries > 0) {
        console.warn(
          `Todoist token refresh failed; retrying... Retries left: [${remainingRetries}]. Error: [${formatLogError(
            error,
          )}].`,
        );
        await new Promise((resolve) => runtimeSetTimeout(resolve, 1000));
        return attempt(remainingRetries - 1);
      }
      throw new Error(`Todoist token refresh failed after retries: [${formatLogError(error)}].`);
    }
  };

  return attempt(retries);
};
