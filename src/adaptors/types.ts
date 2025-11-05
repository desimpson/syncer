import type { SyncItem } from "@/sync/types";

/**
 * Generic interface for a curried adaptor:
 *
 * @typeParam `T` - The source-specific type (e.g., `GoogleTask`)
 */
export type SyncAdaptor<T> = (heading: string) => (item: T) => SyncItem;
