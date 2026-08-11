import { requestUrl } from "obsidian";
import type { z } from "zod";
import {
  GraphAuthorizationError,
  GraphRateLimitError,
  isGraphAuthorizationStatus,
  isGraphRateLimitStatus,
  summariseGraphErrorBody,
} from "@/services/microsoft-graph-errors";
import { microsoftToDoListsPageSchema, microsoftToDoTasksPageSchema } from "@/services/schemas";
import type { MicrosoftToDoList, MicrosoftToDoTask } from "@/services/types";

const GRAPH_TODO_BASE = "https://graph.microsoft.com/v1.0/me/todo";

const throwMicrosoftToDoResponseError = (
  operation: string,
  status: number,
  responseText: string,
): never => {
  const detail = summariseGraphErrorBody(responseText);
  const message =
    detail === undefined
      ? `Microsoft To Do ${operation} failed: ${status}`
      : `Microsoft To Do ${operation} failed: ${status} ${detail}`;
  if (isGraphAuthorizationStatus(status)) {
    throw new GraphAuthorizationError(status, message);
  }
  if (isGraphRateLimitStatus(status)) {
    throw new GraphRateLimitError(status, message);
  }
  throw new Error(message);
};

const parseListsPage = (responseText: string): z.infer<typeof microsoftToDoListsPageSchema> =>
  microsoftToDoListsPageSchema.parse(JSON.parse(responseText) as unknown);

const parseTasksPage = (responseText: string): z.infer<typeof microsoftToDoTasksPageSchema> =>
  microsoftToDoTasksPageSchema.parse(JSON.parse(responseText) as unknown);

const fetchListsPage = async (
  accessToken: string,
  url: string,
): Promise<{
  readonly value: readonly MicrosoftToDoList[];
  readonly nextUrl: string | undefined;
}> => {
  const response = await requestUrl({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throwMicrosoftToDoResponseError("list lists", response.status, response.text);
  }

  const page = parseListsPage(response.text);
  return { value: page.value, nextUrl: page["@odata.nextLink"] };
};

const fetchTasksPage = async (
  accessToken: string,
  url: string,
): Promise<{
  readonly value: readonly MicrosoftToDoTask[];
  readonly nextUrl: string | undefined;
}> => {
  const response = await requestUrl({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throwMicrosoftToDoResponseError("list tasks", response.status, response.text);
  }

  const page = parseTasksPage(response.text);
  return { value: page.value, nextUrl: page["@odata.nextLink"] };
};

const collectPaginatedLists = async (
  accessToken: string,
  initialUrl: string,
): Promise<readonly MicrosoftToDoList[]> => {
  const step = async (
    url: string | undefined,
    accumulated: readonly MicrosoftToDoList[],
  ): Promise<readonly MicrosoftToDoList[]> => {
    if (url === undefined) {
      return accumulated;
    }
    const { value, nextUrl } = await fetchListsPage(accessToken, url);
    return step(nextUrl, [...accumulated, ...value]);
  };

  return step(initialUrl, []);
};

const collectPaginatedTasks = async (
  accessToken: string,
  initialUrl: string,
): Promise<readonly MicrosoftToDoTask[]> => {
  const step = async (
    url: string | undefined,
    accumulated: readonly MicrosoftToDoTask[],
  ): Promise<readonly MicrosoftToDoTask[]> => {
    if (url === undefined) {
      return accumulated;
    }
    const { value, nextUrl } = await fetchTasksPage(accessToken, url);
    return step(nextUrl, [...accumulated, ...value]);
  };

  return step(initialUrl, []);
};

/**
 * Graph To Do list-tasks rejects `$select` (HTTP 400). Prefer `$filter=status eq 'completed'`
 * for the completed map; incomplete feed is filtered client-side so `inProgress` /
 * `waitingOnOthers` / `deferred` stay in the inbox (`ne` is unreliable on this API).
 */
const buildTasksUrl = (listId: string, completed: boolean): string => {
  const base = `${GRAPH_TODO_BASE}/lists/${encodeURIComponent(listId)}/tasks?$top=50`;
  if (!completed) {
    return base;
  }
  return `${base}&$filter=${encodeURIComponent("status eq 'completed'")}`;
};

/**
 * Fetches all Microsoft To Do lists for the signed-in user, following Graph pagination.
 */
export const fetchMicrosoftToDoLists = (
  accessToken: string,
): Promise<readonly MicrosoftToDoList[]> =>
  collectPaginatedLists(accessToken, `${GRAPH_TODO_BASE}/lists?$top=50`);

/**
 * Fetches tasks for a list. When `completed` is false, returns the incomplete feed only.
 */
export const fetchMicrosoftToDoTasks = async (
  accessToken: string,
  listId: string,
  completed = false,
): Promise<readonly MicrosoftToDoTask[]> => {
  const tasks = await collectPaginatedTasks(accessToken, buildTasksUrl(listId, completed));
  if (completed) {
    return tasks;
  }
  return tasks.filter((task) => task.status !== "completed");
};

/**
 * Marks a Microsoft To Do task completed or not started for Obsidian completion sync.
 */
export const updateMicrosoftToDoTaskStatus = async (
  accessToken: string,
  listId: string,
  taskId: string,
  completed: boolean,
): Promise<void> => {
  const url = `${GRAPH_TODO_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
  const response = await requestUrl({
    url,
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: completed ? "completed" : "notStarted" }),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throwMicrosoftToDoResponseError("PATCH task", response.status, response.text);
  }
};

export const MicrosoftToDoService = {
  fetchMicrosoftToDoLists,
  fetchMicrosoftToDoTasks,
  updateMicrosoftToDoTaskStatus,
};
