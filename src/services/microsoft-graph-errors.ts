/**
 * Microsoft Graph authorization failure (HTTP 401 or 403).
 * Jobs typically clear the affected integration credentials and prompt reconnect.
 */
export class GraphAuthorizationError extends Error {
  /** HTTP status from the Graph response (`401` or `403`). */
  public readonly status: number;

  /**
   * @param status - HTTP status (`401` or `403`)
   * @param message - Short failure message for Notices/logs (never raw JSON bodies)
   */
  public constructor(status: number, message: string) {
    super(message);
    this.name = "GraphAuthorizationError";
    this.status = status;
  }
}

/**
 * Microsoft Graph rate-limit failure (HTTP 429).
 * Jobs should notice the user and abort without clearing credentials.
 */
export class GraphRateLimitError extends Error {
  /** HTTP status from the Graph response (`429`). */
  public readonly status: number;

  /**
   * @param status - HTTP status (`429`)
   * @param message - Short failure message for Notices/logs (never raw JSON bodies)
   */
  public constructor(status: number, message: string) {
    super(message);
    this.name = "GraphRateLimitError";
    this.status = status;
  }
}

/** Returns true when `status` is a Graph authorization failure (401 or 403). */
export const isGraphAuthorizationStatus = (status: number): boolean =>
  status === 401 || status === 403;

/** Returns true when `status` is a Graph rate-limit response (429). */
export const isGraphRateLimitStatus = (status: number): boolean => status === 429;

const GRAPH_ERROR_MESSAGE_MAX_LENGTH = 160;

/**
 * Extracts a short Graph `error.code` / `error.message` summary for Notices/logs.
 * Never returns raw JSON bodies.
 */
export const summariseGraphErrorBody = (responseText: string): string | undefined => {
  const trimmed = responseText.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const json: unknown = JSON.parse(trimmed);
    if (typeof json !== "object" || json === null || !("error" in json)) {
      return undefined;
    }
    const { error: errorValue } = json;
    if (typeof errorValue !== "object" || errorValue === null) {
      return undefined;
    }
    const code =
      "code" in errorValue && typeof errorValue.code === "string" ? errorValue.code.trim() : "";
    const message =
      "message" in errorValue && typeof errorValue.message === "string"
        ? errorValue.message.trim()
        : "";
    if (code.length === 0 && message.length === 0) {
      return undefined;
    }

    const combined =
      code.length > 0 && message.length > 0
        ? `${code}: ${message}`
        : code.length > 0
          ? code
          : message;
    if (combined.length <= GRAPH_ERROR_MESSAGE_MAX_LENGTH) {
      return combined;
    }
    return `${combined.slice(0, GRAPH_ERROR_MESSAGE_MAX_LENGTH - 1)}…`;
  } catch {
    return undefined;
  }
};
