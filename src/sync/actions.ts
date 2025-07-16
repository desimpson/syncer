import type { SyncAction, SyncItem } from "@/sync/types";

/**
 * Detect items to create: present in incoming, missing in existing.
 */
const getCreates = (incoming: SyncItem[], existingMap: Map<string, SyncItem>): SyncAction[] =>
  incoming
    .filter((item) => !existingMap.has(item.id))
    .map((item) => ({ item, operation: "create" as const }));

/**
 * Detect items to update: present in both, but metadata differs.
 */
const getUpdates = (incoming: SyncItem[], existingMap: Map<string, SyncItem>): SyncAction[] =>
  incoming
    .filter((item) => {
      const existing = existingMap.get(item.id);
      if (existing === undefined) {
        return false;
      }

      // Compare all metadata fields
      return (
        existing.title !== item.title ||
        existing.link !== item.link ||
        existing.source !== item.source ||
        existing.heading !== item.heading
      );
    })
    .map((item) => ({ item, operation: "update" as const }));

/**
 * Detect items to delete: present in existing, missing in incoming.
 */
const getDeletes = (incomingIds: Set<string>, existing: SyncItem[]): SyncAction[] =>
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
  incomingItems: SyncItem[],
  existingItems: SyncItem[],
): SyncAction[] => {
  const existingMap = new Map(existingItems.map((item) => [item.id, item]));
  const incomingIds = new Set(incomingItems.map((item) => item.id));

  return [
    ...getCreates(incomingItems, existingMap),
    ...getUpdates(incomingItems, existingMap),
    ...getDeletes(incomingIds, existingItems),
  ];
};
