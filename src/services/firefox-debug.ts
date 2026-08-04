/**
 * Temporary Firefox diagnostics for first-sync bookmark staleness.
 * Remove after root cause is confirmed and fixed.
 */
export const FIREFOX_DEBUG_PREFIX = "[Syncer Firefox debug]";

type DebugPayload = Record<string, unknown>;
export type FirefoxDebugContext = {
  correlationId?: string;
};

export const firefoxDebugLog = (
  message: string,
  payload?: DebugPayload,
  context?: FirefoxDebugContext,
): void => {
  void message;
  void payload;
  void context;
};

export const firefoxDebugWarn = (
  message: string,
  payload?: DebugPayload,
  context?: FirefoxDebugContext,
): void => {
  void message;
  void payload;
  void context;
};

export const firefoxDebugError = (
  message: string,
  payload?: DebugPayload,
  context?: FirefoxDebugContext,
): void => {
  void message;
  void payload;
  void context;
};
