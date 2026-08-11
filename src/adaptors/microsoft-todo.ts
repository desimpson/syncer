import type { MicrosoftToDoTask } from "@/services/types";
import { MICROSOFT_TO_DO_SOURCE, type SyncItem } from "@/sync/types";

type ToDoLinkHost = "live.com" | "office.com";

const toDoHostFromTenantSegment = (tenantSegment: string): ToDoLinkHost =>
  tenantSegment === "consumers" ? "live.com" : "office.com";

/**
 * Builds a Microsoft To Do deep link from tenant segment and task/list identifiers.
 *
 * Primary: task deep link when `taskId` is non-empty.
 * Fallback: list-level deep link when `taskId` is missing or empty.
 */
export const buildMicrosoftToDoTaskLink = (
  tenantSegment: string,
  listId: string,
  taskId: string,
): string => {
  const host = toDoHostFromTenantSegment(tenantSegment);
  const trimmedTaskId = taskId.trim();
  if (trimmedTaskId.length === 0) {
    return `https://to-do.${host}/tasks/${encodeURIComponent(listId)}`;
  }
  return `https://to-do.${host}/tasks/id/${encodeURIComponent(trimmedTaskId)}`;
};

/**
 * Human-readable label for a stored Microsoft tenant segment (To Do settings UI).
 */
export const formatMicrosoftToDoTenantLabel = (tenantSegment: string): string => {
  if (tenantSegment === "consumers") {
    return "Personal";
  }
  if (tenantSegment === "organizations") {
    return "Work or school (any)";
  }
  return `Work or school · ${tenantSegment}`;
};

/**
 * Maps a Microsoft To Do Graph task to a generic `SyncItem`.
 */
export const createMicrosoftToDoTaskAdaptor =
  (
    heading: string,
    tenantSegment: string,
    listId: string,
  ): ((item: MicrosoftToDoTask) => SyncItem) =>
  ({ id, title, status }) => ({
    source: MICROSOFT_TO_DO_SOURCE,
    id,
    title,
    link: buildMicrosoftToDoTaskLink(tenantSegment, listId, id),
    heading,
    completed: status === "completed",
  });
