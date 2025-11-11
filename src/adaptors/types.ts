import type { SyncItem } from "@/sync/types";

/**
 * Generic adaptor type mapping source-specific items to `SyncItem`s.
 *
 * @typeParam `T` - The source-specific type (e.g., `GoogleTask`)
 */
export type SyncAdaptor<T> = (heading: string) => (item: T) => SyncItem;
