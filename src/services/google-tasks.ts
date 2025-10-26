import { googleTasksListsResponseSchema, googleTasksResponseSchema } from "./schemas";
import type { GoogleTask, GoogleTasksList } from "./types";

const tasksBaseUrl = "https://tasks.googleapis.com/tasks/v1";

/**
 * Fetches a page of Google Tasks task lists for the authenticated user. Doesn't
 * include the tasks themselves.
 *
 * @param accessToken - A valid OAuth 2.0 access token for the Google Tasks API
 * @returns A Promise resolving to the array of task lists
 * @throws Throws an error if the HTTP request fails or if the response is
 *         invalid
 */
export const fetchGoogleTasksLists = async (
  accessToken: string,
): Promise<readonly GoogleTasksList[]> => {
  const response = await fetch(`${tasksBaseUrl}/users/@me/lists`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.ok) {
    const data: unknown = await response.json();
    return googleTasksListsResponseSchema.parse(data).items;
  }

  throw new Error(`Failed to get task lists: ${response.status}`);
};

/**
 * Creates a Google Tasks fetcher function for a specific task list.
 *
 * @param accessToken - A valid OAuth 2.0 access token for the Google Tasks API
 * @returns A function that fetches tasks for the specified task list
 * @throws When the HTTP request fails or the response is invalid
 */
export const createGoogleTasksFetcher =
  (accessToken: string) =>
  (listId: string): Promise<readonly GoogleTask[]> =>
    fetchGoogleTasks(accessToken, listId);

/**
 * Fetches a page of Google Tasks for a specific task list from the Google Tasks
 * API. These are the actual tasks, i.e., items you mark "Completed" in the
 * Google Tasks app.
 *
 * @param accessToken - A valid OAuth 2.0 access token for the Google Tasks API
 * @param listId - The ID of the task list to fetch tasks from
 * @returns A Promise resolving to an array of tasks
 * @throws When the HTTP request fails or the response is invalid
 */
export const fetchGoogleTasks = async (
  accessToken: string,
  listId: string,
): Promise<readonly GoogleTask[]> => {
  const response = await fetch(`${tasksBaseUrl}/lists/${listId}/tasks`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.ok) {
    const data: unknown = await response.json();
    return googleTasksResponseSchema.parse(data).items;
  }

  throw new Error(`Failed to get tasks for list ${listId}: ${response.status}`);
};
