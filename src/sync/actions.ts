import type { SyncAction, SyncItem, SyncOperation } from "@/sync/types";

/**
 * Detect items to create: present in incoming, missing in existing.
 */
const getCreates = (
  incoming: readonly SyncItem[],
  existingMap: Map<string, SyncItem>,
): readonly SyncAction[] =>
  incoming
    .filter((item) => !existingMap.has(item.id))
    .map((item) => ({ item, operation: "create" as const }));

/**
 * Detect items to update: present in both, but metadata differs.
 */
const getUpdates = (
  incoming: readonly SyncItem[],
  existingMap: Map<string, SyncItem>,
): readonly SyncAction[] =>
  incoming
    .filter((item) => {
      const existing = existingMap.get(item.id);
      if (existing === undefined) {
        return false;
      }

      // Compare all metadata fields, including completion status
      return (
        existing.title !== item.title ||
        existing.link !== item.link ||
        existing.source !== item.source ||
        existing.heading !== item.heading ||
        existing.completed !== item.completed
      );
    })
    .map((item) => ({ item, operation: "update" as const }));

/**
 * Detect items to delete: present in existing, missing in incoming.
 */
const getDeletes = (
  incomingIds: Set<string>,
  existing: readonly SyncItem[],
): readonly SyncAction[] =>
  existing
    .filter((item) => !incomingIds.has(item.id))
    .map((item) => ({ item, operation: "delete" as const }));

/**
 * Generate sync actions comparing incoming and existing SyncItems.
 *
 * @param incomingItems - Items fetched from external sources
 * @param existingItems - Items already present in the Markdown file
 * @returns A list of create/update/delete actions to reconcile state
 */
export const generateSyncActions = (
  incomingItems: readonly SyncItem[],
  existingItems: readonly SyncItem[],
): readonly SyncAction[] => {
  const existingMap = new Map(existingItems.map((item) => [item.id, item]));
  const incomingIds = new Set(incomingItems.map((item) => item.id));

  return [
    ...getCreates(incomingItems, existingMap),
    ...getUpdates(incomingItems, existingMap),
    ...getDeletes(incomingIds, existingItems),
  ];
};

/**
 * Filter sync actions by a predicate function.
 *
 * @param actions - Actions to filter
 * @param predicate - Function that returns true for actions to keep
 * @returns Filtered actions
 */
export const filterActions = (
  actions: readonly SyncAction[],
  predicate: (action: SyncAction) => boolean,
): readonly SyncAction[] => actions.filter(predicate);

/**
 * Filter sync actions by operation type.
 *
 * @param actions - Actions to filter
 * @param operation - Operation type to filter by
 * @returns Actions with the specified operation
 */
export const filterByOperation = (
  actions: readonly SyncAction[],
  operation: SyncOperation,
): readonly SyncAction[] => actions.filter((action) => action.operation === operation);

/**
 * Group sync actions by operation type.
 *
 * @param actions - Actions to group
 * @returns Object containing actions grouped by operation
 */
export const groupByOperation = (
  actions: readonly SyncAction[],
): {
  creates: readonly SyncAction[];
  updates: readonly SyncAction[];
  deletes: readonly SyncAction[];
} => ({
  creates: filterByOperation(actions, "create"),
  updates: filterByOperation(actions, "update"),
  deletes: filterByOperation(actions, "delete"),
});

/**
 * Extract SyncItems from create actions.
 *
 * @param actions - Actions to extract items from
 * @returns Items from create actions
 */
export const getCreateItems = (actions: readonly SyncAction[]): readonly SyncItem[] =>
  filterByOperation(actions, "create").map((action) => action.item);

/**
 * Build a map of update and delete actions keyed by "id:source".
 * Useful for efficiently looking up actions when processing file lines.
 *
 * @param actions - Actions to build map from
 * @returns Map of actions keyed by "id:source"
 */
export const buildUpdateDeleteMap = (actions: readonly SyncAction[]): Map<string, SyncAction> =>
  new Map(
    filterActions(actions, (action) => action.operation !== "create").map((action) => [
      `${action.item.id}:${action.item.source}`,
      action,
    ]),
  );

/**
 * Predicate to determine if a delete action for a completed task should be preserved.
 * Completed tasks are preserved in Obsidian even if deleted from the external source.
 *
 * @param action - Action to check
 * @returns True if the action should be preserved
 */
export const shouldPreserveCompletedDeletes = (action: SyncAction): boolean =>
  action.operation !== "delete" || !action.item.completed;
