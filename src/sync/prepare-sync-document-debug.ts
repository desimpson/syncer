/**
 * Temporary prepare/stability diagnostics for delete-then-immediate-sync repro.
 * Call sites stay; enable logging in a follow-up commit while debugging, then
 * revert that commit (or restore these no-ops) before merge.
 */
export const PREPARE_SYNC_DOCUMENT_DEBUG_PREFIX = "[Syncer prepare debug]";

type DebugPayload = Record<string, unknown>;

let tickCounter = 0;

/** Allocate a short-lived id so one Manual sync / interval tick can be followed in the console. */
export const allocatePrepareTickId = (): string => {
  tickCounter += 1;
  return `tick-${tickCounter}-${Date.now().toString(36)}`;
};

export const prepareSyncDocumentDebugLog = (message: string, payload?: DebugPayload): void => {
  void message;
  void payload;
};

export const prepareSyncDocumentDebugWarn = (message: string, payload?: DebugPayload): void => {
  void message;
  void payload;
};

export const prepareSyncDocumentDebugError = (message: string, payload?: DebugPayload): void => {
  void message;
  void payload;
};
