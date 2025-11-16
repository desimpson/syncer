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
  // Explicitly request only incomplete, non-hidden tasks for clarity and future-proofing.
  const query = new URLSearchParams({
    showCompleted: "false",
    showHidden: "false",
  }).toString();

  const response = await fetch(`${tasksBaseUrl}/lists/${listId}/tasks?${query}`, {
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

/**
 * Marks a Google Task as completed or uncompleted.
 *
 * @param accessToken - A valid OAuth 2.0 access token for the Google Tasks API
 * @param listId - The ID of the task list containing the task
 * @param taskId - The ID of the task to update
 * @param completed - Whether to mark the task as completed (true) or uncompleted (false)
 * @throws When the HTTP request fails
 */
export const updateGoogleTaskStatus = async (
  accessToken: string,
  listId: string,
  taskId: string,
  completed: boolean,
): Promise<void> => {
  // Prepare the update payload - only send the fields we want to update
  const updatePayload = completed
    ? {
        status: "completed",
        completed: new Date().toISOString(),
      }
    : {
        status: "needsAction",
        /* Setting `status` to "needsAction" is sufficient to remove the
        `completed` timestamp field; assigning `undefined` or `null` to
        `completed` is not strictly necessary. */
        completed: undefined,
      };

  // Update the task using PATCH to update only specific fields
  const patchResponse = await fetch(`${tasksBaseUrl}/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!patchResponse.ok) {
    throw new Error(`Failed to update task ${taskId} for list ${listId}: ${patchResponse.status}`);
  }
};

export const GoogleTasksService = {
  createGoogleTasksFetcher,
  fetchGoogleTasksLists,
  updateGoogleTaskStatus,
};
