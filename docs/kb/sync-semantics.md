# Sync semantics

Product rules that are easy to break. Owning code is the authority; keep this page aligned when jobs/writer change.

## Markdown item format

Written by [`src/sync/writer.ts`](../../src/sync/writer.ts):

```text
- [ ] [title](link) <!-- {"id":"…","source":"google-tasks","title":"…","link":"…","heading":"## Inbox"} -->
```

- Checkbox is the completion source of truth in the file
- Metadata JSON omits `completed` (derived from checkbox)
- Lookup key for update/delete: `id:source`
- Optional in-file anchor: `<!-- syncer:anchor -->` — creates insert after the first heading following the marker

## Reconcile

[`generateSyncActions`](../../src/sync/actions.ts): create (in incoming, not existing), update (metadata/completion differ), delete (in existing, not incoming).

**Preserve completed deletes:** [`shouldPreserveCompletedDeletes`](../../src/sync/actions.ts) — completed Obsidian lines are **not** deleted when the remote item drops out of the incoming feed.

## Google Tasks

Owning job: [`src/jobs/google-tasks.ts`](../../src/jobs/google-tasks.ts).

- Incoming feed = **incomplete** tasks from selected lists only
- Completing a task in Google drops it from the feed → line removed on next sync unless the Obsidian line is already `[x]` (completed-preserve filters on `action.item.completed`)
- `syncCompletionStatus`: push Obsidian checkbox changes to Google; uncomplete-in-Obsidian can restore a task completed in Google
- `enableDeleteSync`: vault line removal can delete the Google task in Google Tasks (confirmation optional)
- **SyncGuard** (`plugin/index.ts`): skip delete-detection while scheduled sync writes the file
- **`manuallyDeletedTaskIds`**: prevent re-adding tasks the user deleted from Obsidian on a later sync
- Deselecting a list drops those task IDs from incoming → delete actions for unmatched items file-wide by `id:source`; completed lines preserved via `shouldPreserveCompletedDeletes`

## Microsoft Outlook

Owning job: [`src/jobs/microsoft-outlook.ts`](../../src/jobs/microsoft-outlook.ts).

- Incoming feed = messages with Outlook follow-up flag `flagged` only (`fetchFlaggedMessages` in `src/services/outlook-mail.ts`); unflagged or `complete` messages drop out on the next sync
- `syncCompletionStatus`: checking/unchecking in Obsidian updates the Outlook flag on the next sync
- Account kind + optional Entra tenant ID → tenant segment for Graph auth

## Firefox Bookmarks

Owning job: [`src/jobs/firefox-bookmarks.ts`](../../src/jobs/firefox-bookmarks.ts).

- Incoming feed = bookmarks in selected folder(s), **recursively** including subfolders
- Filters: separators, `place:` URIs, tag-root duplicates
- Identity: `moz_bookmarks.guid` → `source: firefox-bookmarks`
- One-way sync only; Obsidian checkbox is local-only (no write-back to Firefox)
- Removing a bookmark from a selected folder removes its line on next sync unless the Obsidian line is already `[x]` (completed-preserve)
- Reads `places.sqlite` via copy-on-read + **sql.js** (WASM bundled as `sql-wasm.wasm` next to `main.js`)
- While Firefox is open (`-wal` present), hot-copy merges WAL via `sqlite3` CLI or Python (no `-shm` copy) before sql.js opens; if merge fails, sync may miss newest bookmarks (notice asks to close Firefox briefly)
- Desktop only (`Platform.isDesktopApp`); settings hidden on mobile

## SyncGuard

[`src/sync/sync-guard.ts`](../../src/sync/sync-guard.ts), wired in [`plugin/index.ts`](../../src/plugin/index.ts):

- Suppresses delete-detection while a job writes the file
- Content cache refreshed **before** guard release so post-sync `modify` events see no spurious deletions
