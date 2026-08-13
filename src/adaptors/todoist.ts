import type { TodoistTask } from "@/services/types";
import { TODOIST_SOURCE, type SyncItem } from "@/sync/types";

/**
 * Builds a Todoist web-app deep link for a task id.
 */
export const buildTodoistTaskLink = (taskId: string): string =>
  `https://app.todoist.com/app/task/${encodeURIComponent(taskId)}`;

/**
 * Creates a mapper from a Todoist API task to a generic `SyncItem`.
 */
export const createTodoistTaskAdaptor =
  (heading: string): ((item: TodoistTask) => SyncItem) =>
  ({ id, content, checked }) => ({
    source: TODOIST_SOURCE,
    id,
    title: content,
    link: buildTodoistTaskLink(id),
    heading,
    completed: checked,
  });
