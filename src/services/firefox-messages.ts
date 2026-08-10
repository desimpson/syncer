/** Stable user-facing strings for Firefox Bookmarks integration. */
export const FIREFOX_NOTICE = {
  profilePathNotFound: "Firefox profile path not found.",
  placesMissingOrUnreadable: "places.sqlite missing or unreadable in the selected Firefox profile.",
  couldNotOpenDatabase:
    "Could not open Firefox database. Try closing Firefox, then refresh folders again.",
  staleFolders: "Some selected bookmark folders were not found in the current profile.",
  noValidFolders: "No valid bookmark folders selected for Firefox sync.",
  firefoxWalNotMerged:
    "Firefox is open; newest bookmarks may be missing. Close Firefox briefly, then sync again.",
  syncDocumentMissing: (path: string) =>
    `Sync document "${path}" not found. Please update settings or create the file.`,
  syncDocumentMissingOnDisk: (path: string) =>
    `Sync document "${path}" is missing on disk. Please recreate it or update settings.`,
} as const;
