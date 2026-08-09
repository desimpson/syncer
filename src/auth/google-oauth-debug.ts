/**
 * Temporary Google OAuth diagnostics for invalid_client / connect failures.
 * Remove after root cause is confirmed and fixed.
 */
export const GOOGLE_OAUTH_DEBUG_PREFIX = "[Syncer Google OAuth debug]";

type DebugPayload = Record<string, unknown>;

export type GoogleOAuthDebugContext = {
  integration?: string;
  phase?: string;
};

const logWithPrefix = (
  level: "info" | "warn" | "error",
  message: string,
  payload?: DebugPayload,
  context?: GoogleOAuthDebugContext,
): void => {
  const prefix = GOOGLE_OAUTH_DEBUG_PREFIX;
  const contextSuffix =
    context === undefined
      ? ""
      : ` integration=${context.integration ?? "?"} phase=${context.phase ?? "?"}`;
  const line = `${prefix}${contextSuffix} ${message}`;

  if (payload === undefined) {
    console[level](line);
    return;
  }

  console[level](line, payload);
};

export const describeGoogleClientId = (clientId: string): DebugPayload => {
  const trimmed = clientId.trim();
  const suffix = ".googleusercontent.com";
  const hasExpectedSuffix = trimmed.endsWith(suffix);
  const prefixPart = hasExpectedSuffix ? trimmed.slice(0, -suffix.length) : trimmed;

  return {
    length: trimmed.length,
    isEmpty: trimmed.length === 0,
    looksLikeDummy: trimmed === "dummy" || trimmed.startsWith("dummy-"),
    hasGoogleUsercontentSuffix: hasExpectedSuffix,
    prefix:
      prefixPart.length > 12 ? `${prefixPart.slice(0, 8)}…${prefixPart.slice(-4)}` : prefixPart,
    fullSuffix: hasExpectedSuffix ? suffix : undefined,
  };
};

export const googleOAuthDebugLog = (
  message: string,
  payload?: DebugPayload,
  context?: GoogleOAuthDebugContext,
): void => {
  logWithPrefix("info", message, payload, context);
};

export const googleOAuthDebugWarn = (
  message: string,
  payload?: DebugPayload,
  context?: GoogleOAuthDebugContext,
): void => {
  logWithPrefix("warn", message, payload, context);
};

export const googleOAuthDebugError = (
  message: string,
  payload?: DebugPayload,
  context?: GoogleOAuthDebugContext,
): void => {
  logWithPrefix("error", message, payload, context);
};

export const redactAuthUrl = (authUrl: string): string => {
  try {
    const url = new URL(authUrl);
    const clientId = url.searchParams.get("client_id");
    if (clientId !== null && clientId.length > 12) {
      url.searchParams.set("client_id", `${clientId.slice(0, 8)}…${clientId.slice(-4)}`);
    }
    return url.toString();
  } catch {
    return authUrl;
  }
};
