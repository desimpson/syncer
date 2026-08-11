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
 *
 * @param tenantSegment - Stored OAuth tenant path (`consumers`, `organizations`, or tenant GUID)
 * @param listId - To Do list id (used for list-level fallback links)
 * @param taskId - Graph task id; empty/whitespace triggers list fallback
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
 *
 * @param tenantSegment - Stored OAuth tenant path (`consumers`, `organizations`, or tenant GUID)
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
 * Creates a mapper from a Microsoft To Do Graph task to a generic `SyncItem`.
 *
 * @param heading - Target sync heading written into item metadata
 * @param tenantSegment - Tenant segment used to choose the deep-link host
 * @param listId - List id for deep-link fallback when task id is empty
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
