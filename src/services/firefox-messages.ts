/** Stable user-facing strings for Firefox Bookmarks integration. */
export const FIREFOX_NOTICE = {
  profilePathNotFound: "Firefox profile path not found.",
  placesMissingOrUnreadable: "places.sqlite missing or unreadable in the selected Firefox profile.",
  wasmNotFound:
    "sql-wasm.wasm is missing from the plugin folder. Run npm run build:dev and npm run sync, then reload the plugin.",
  couldNotOpenDatabase:
    "Could not open Firefox database. Try closing Firefox, then refresh folders again.",
  staleFolders: "Some selected bookmark folders were not found in the current profile.",
  noValidFolders: "No valid bookmark folders selected for Firefox sync.",
  firefoxMayBeOpen: "Firefox may be open — bookmark data may lag a few seconds behind the browser.",
  syncDocumentMissing: (path: string) =>
    `Sync document "${path}" not found. Please update settings or create the file.`,
  syncDocumentMissingOnDisk: (path: string) =>
    `Sync document "${path}" is missing on disk. Please recreate it or update settings.`,
} as const;
