/**
 * Temporary Firefox diagnostics for first-sync bookmark staleness.
 * Remove after root cause is confirmed and fixed.
 */
export const FIREFOX_DEBUG_PREFIX = "[Syncer Firefox debug]";

type DebugPayload = Record<string, unknown>;
export type FirefoxDebugContext = {
  correlationId?: string;
};

const limitString = (value: string, max = 800): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const normalisePayload = (payload: DebugPayload): DebugPayload =>
  Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === "string" ? limitString(value) : value,
    ]),
  );

const withContext = (
  payload: DebugPayload | undefined,
  context: FirefoxDebugContext | undefined,
): DebugPayload | undefined => {
  if (context?.correlationId === undefined) {
    return payload;
  }
  return {
    ...payload,
    correlationId: context.correlationId,
  };
};

const emitDebug =
  (output: (...data: unknown[]) => void) =>
  (message: string, payload?: DebugPayload, context?: FirefoxDebugContext): void => {
    const payloadWithContext = withContext(payload, context);
    if (payloadWithContext === undefined) {
      output(FIREFOX_DEBUG_PREFIX, message);
      return;
    }
    output(FIREFOX_DEBUG_PREFIX, message, normalisePayload(payloadWithContext));
  };

export const firefoxDebugLog = emitDebug((...arguments_) => console.log(...arguments_));
export const firefoxDebugWarn = emitDebug((...arguments_) => console.warn(...arguments_));
export const firefoxDebugError = emitDebug((...arguments_) => console.error(...arguments_));

export const createFirefoxDebugCorrelationId = (): string => {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `ff-sync-${timestamp}-${suffix}`;
};
