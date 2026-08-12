/**
 * A generic item that can be synchronised to a Markdown file in the Obsidian
 * vault.
 */
export type SyncItem = {
  id: string;
  source: string; // e.g., 'google-tasks', 'firefox-bookmarks'
  title: string;
  link: string;
  heading: string;
  completed: boolean;
};

/**
 * The different sync operations that can be performed on a synchronisation item.
 */
export type SyncOperation = "create" | "update" | "delete";

/**
 * A synchronisation action that can be performed on a synchronisation item.
 */
export type SyncAction = {
  item: SyncItem;
  operation: SyncOperation;
};

/**
 * The different supported sync sources.
 */
export type SyncSource =
  | "google-tasks"
  | "microsoft-outlook"
  | "microsoft-to-do"
  | "gmail-starred"
  | "firefox-bookmarks"
  | "azure-devops";

/** `SyncItem.source` / markdown metadata value for Gmail Starred. */
export const GMAIL_STARRED_SOURCE = "gmail-starred" satisfies SyncSource;

/** `SyncItem.source` / markdown metadata value for Microsoft Outlook. */
export const MICROSOFT_OUTLOOK_SOURCE = "microsoft-outlook" satisfies SyncSource;

/** `SyncItem.source` / markdown metadata value for Microsoft To Do. */
export const MICROSOFT_TO_DO_SOURCE = "microsoft-to-do" satisfies SyncSource;

/** `SyncItem.source` / markdown metadata value for Firefox Bookmarks. */
export const FIREFOX_BOOKMARKS_SOURCE = "firefox-bookmarks" satisfies SyncSource;

/** `SyncItem.source` / markdown metadata value for Azure DevOps. */
export const AZURE_DEVOPS_SOURCE = "azure-devops" satisfies SyncSource;

/**
 * A parsed Markdown line item with sync metadata.
 */
export type ParsedLine = {
  title: string;
  link: string;
  id: string;
  source: string;
  heading: string;
  completed: boolean;
};
