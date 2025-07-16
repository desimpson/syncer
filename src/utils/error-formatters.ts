import { ZodError } from "zod";

type ErrorLike = unknown;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return String(value);
  }
};

const formatError = (error: ErrorLike): { message: string; stack?: string } => {
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => issue.message).join("; ");
    return { message: message || "Unknown validation error" };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error === null || error === undefined) {
    return { message: String(error) };
  }
  return { message: safeStringify(error) };
};

/**
 * Formats an error for displaying in the UI.
 *
 * @param error - The error to format
 * @returns The error message suitable for displaying in the UI
 */
export const formatUiError = (error: ErrorLike): string => {
  return formatError(error).message;
};

/**
 * Formats an error for logging.
 *
 * @param error - The error to format
 * @param includeStack - Whether to include the stack trace in the output
 * @returns  The formatted error string suitable for logging
 */
export const formatLogError = (error: ErrorLike, includeStack = true): string => {
  const { message, stack } = formatError(error);
  return includeStack && stack !== undefined ? `${message}: ${stack}` : message;
};
