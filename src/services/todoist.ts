import { requestUrl } from "obsidian";
import type { z } from "zod";
import {
  TodoistAuthorizationError,
  TodoistRateLimitError,
  isTodoistAuthorizationStatus,
  isTodoistRateLimitStatus,
} from "@/services/todoist-errors";
import {
  todoistCompletedTasksPageSchema,
  todoistProjectSchema,
  todoistResultsPageSchema,
  todoistTaskSchema,
} from "@/services/schemas";
import type { TodoistProject, TodoistTask } from "@/services/types";
import { runtimeSetTimeout } from "@/utils/browser-runtime";

export const TODOIST_API_BASE = "https://api.todoist.com/api/v1";
const MAX_THROTTLE_RETRIES = 3;
const COMPLETED_TASKS_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

const todoistProjectsPageSchema = todoistResultsPageSchema(todoistProjectSchema);
const todoistTasksPageSchema = todoistResultsPageSchema(todoistTaskSchema);

type RequestResult = {
  readonly status: number;
  readonly text: string;
  readonly headers: Record<string, string> | undefined;
};

const parseRetryAfterMs = (headers: Record<string, string> | undefined): number => {
  const retryAfter = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (retryAfter === undefined) {
    return 1000;
  }
  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
};

const summariseTodoistErrorBody = (responseText: string): string | undefined => {
  const trimmed = responseText.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    const json: unknown = JSON.parse(trimmed);
    if (typeof json === "object" && json !== null) {
      const record = json as Record<string, unknown>;
      const error = record["error"];
      const description = record["error_description"] ?? record["message"];
      if (typeof error === "string" && typeof description === "string") {
        return `${error}: ${description}`;
      }
      if (typeof error === "string") {
        return error;
      }
      if (typeof description === "string") {
        return description;
      }
    }
  } catch {
    // fall through to raw text
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
};

const throwTodoistResponseError = (
  operation: string,
  status: number,
  responseText: string,
): never => {
  const detail = summariseTodoistErrorBody(responseText);
  const message =
    detail === undefined
      ? `Todoist ${operation} failed: ${status}`
      : `Todoist ${operation} failed: ${status} ${detail}`;
  if (isTodoistAuthorizationStatus(status)) {
    throw new TodoistAuthorizationError(status, message);
  }
  if (isTodoistRateLimitStatus(status)) {
    throw new TodoistRateLimitError(status, message);
  }
  throw new Error(message);
};

const todoistRequest = async (
  accessToken: string,
  url: string,
  init: { method?: string; body?: string } = {},
): Promise<RequestResult> => {
  const attempt = async (remainingRetries: number): Promise<RequestResult> => {
    const response = await requestUrl({
      url,
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      throw: false,
    });

    if (response.status === 429 && remainingRetries > 0) {
      const delayMs = parseRetryAfterMs(response.headers);
      await new Promise((resolve) => runtimeSetTimeout(resolve, delayMs));
      return attempt(remainingRetries - 1);
    }

    return { status: response.status, text: response.text, headers: response.headers };
  };

  return attempt(MAX_THROTTLE_RETRIES);
};

const collectCursorPages = async <T>(
  fetchPage: (cursor: string | undefined) => Promise<{
    readonly items: readonly T[];
    readonly nextCursor: string | undefined;
  }>,
): Promise<readonly T[]> => {
  const step = async (
    cursor: string | undefined,
    accumulated: readonly T[],
  ): Promise<readonly T[]> => {
    const { items, nextCursor } = await fetchPage(cursor);
    const merged = [...accumulated, ...items];
    if (nextCursor === undefined || nextCursor.length === 0) {
      return merged;
    }
    return step(nextCursor, merged);
  };

  return step(undefined, []);
};

const parseProjectsPage = (responseText: string): z.infer<typeof todoistProjectsPageSchema> =>
  todoistProjectsPageSchema.parse(JSON.parse(responseText) as unknown);

const parseTasksPage = (responseText: string): z.infer<typeof todoistTasksPageSchema> =>
  todoistTasksPageSchema.parse(JSON.parse(responseText) as unknown);

const parseCompletedTasksPage = (
  responseText: string,
): z.infer<typeof todoistCompletedTasksPageSchema> =>
  todoistCompletedTasksPageSchema.parse(JSON.parse(responseText) as unknown);

const buildApiUrl = (path: string, parameters: Record<string, string | undefined>): string => {
  const url = new URL(`${TODOIST_API_BASE}${path}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

const fetchProjectsPage = async (
  accessToken: string,
  cursor: string | undefined,
): Promise<{
  readonly items: readonly TodoistProject[];
  readonly nextCursor: string | undefined;
}> => {
  const response = await todoistRequest(
    accessToken,
    buildApiUrl("/projects", { cursor, limit: "200" }),
  );

  if (response.status < 200 || response.status >= 300) {
    throwTodoistResponseError("list projects", response.status, response.text);
  }

  const page = parseProjectsPage(response.text);
  const rawCursor = page.next_cursor;
  const nextCursor =
    rawCursor === null || rawCursor === undefined || rawCursor.length === 0 ? undefined : rawCursor;
  return {
    items: page.results,
    nextCursor,
  };
};

const fetchActiveTasksPage = async (
  accessToken: string,
  projectId: string,
  cursor: string | undefined,
): Promise<{ readonly items: readonly TodoistTask[]; readonly nextCursor: string | undefined }> => {
  const response = await todoistRequest(
    accessToken,
    buildApiUrl("/tasks", { project_id: projectId, cursor, limit: "200" }),
  );

  if (response.status < 200 || response.status >= 300) {
    throwTodoistResponseError("list tasks", response.status, response.text);
  }

  const page = parseTasksPage(response.text);
  const rawCursor = page.next_cursor;
  const nextCursor =
    rawCursor === null || rawCursor === undefined || rawCursor.length === 0 ? undefined : rawCursor;
  return {
    items: page.results.map((task) => ({ ...task, checked: false })),
    nextCursor,
  };
};

const completedTasksDateRange = (): { since: string; until: string } => {
  const untilDate = new Date();
  const sinceDate = new Date(untilDate.getTime() - COMPLETED_TASKS_LOOKBACK_MS);
  return { since: sinceDate.toISOString(), until: untilDate.toISOString() };
};

const fetchCompletedTasksPage = async (
  accessToken: string,
  projectId: string,
  cursor: string | undefined,
): Promise<{ readonly items: readonly TodoistTask[]; readonly nextCursor: string | undefined }> => {
  const { since, until } = completedTasksDateRange();
  const response = await todoistRequest(
    accessToken,
    buildApiUrl("/tasks/completed/by_completion_date", {
      project_id: projectId,
      since,
      until,
      cursor,
      limit: "200",
    }),
  );

  if (response.status < 200 || response.status >= 300) {
    throwTodoistResponseError("list completed tasks", response.status, response.text);
  }

  const page = parseCompletedTasksPage(response.text);
  const rawCursor = page.next_cursor;
  const nextCursor =
    rawCursor === null || rawCursor === undefined || rawCursor.length === 0 ? undefined : rawCursor;
  return {
    items: page.items.map((task) => ({ ...task, checked: true })),
    nextCursor,
  };
};

/**
 * Fetches all Todoist projects for the signed-in user, walking cursor pagination.
 */
export const fetchTodoistProjects = async (
  accessToken: string,
): Promise<readonly TodoistProject[]> =>
  collectCursorPages((cursor) => fetchProjectsPage(accessToken, cursor));

/**
 * Fetches tasks for a project. When `completed` is false, returns the active feed only.
 */
export const fetchTodoistTasks = async (
  accessToken: string,
  projectId: string,
  completed = false,
): Promise<readonly TodoistTask[]> => {
  if (completed) {
    return collectCursorPages((cursor) => fetchCompletedTasksPage(accessToken, projectId, cursor));
  }

  const tasks = await collectCursorPages((cursor) =>
    fetchActiveTasksPage(accessToken, projectId, cursor),
  );
  return tasks.filter((task) => !task.checked);
};

/**
 * Marks a Todoist task completed or reopens it for Obsidian completion sync.
 */
export const updateTodoistTaskStatus = async (
  accessToken: string,
  taskId: string,
  completed: boolean,
): Promise<void> => {
  const action = completed ? "close" : "reopen";
  const response = await todoistRequest(
    accessToken,
    `${TODOIST_API_BASE}/tasks/${encodeURIComponent(taskId)}/${action}`,
    { method: "POST" },
  );

  if (response.status < 200 || response.status >= 300) {
    throwTodoistResponseError(`${action} task`, response.status, response.text);
  }
};

/** Convenience namespace for Todoist API helpers (settings UI / jobs). */
export const TodoistService = {
  fetchTodoistProjects,
  fetchTodoistTasks,
  updateTodoistTaskStatus,
};
