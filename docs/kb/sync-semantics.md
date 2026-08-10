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

### Atomic write path

Jobs write via [`reconcileSyncSourceAtomically`](../../src/sync/writer.ts), which:

1. runs inside one `vault.process` callback,
2. parses existing items from callback `content`,
3. computes reconcile actions against that same snapshot,
4. applies updates/deletes/creates before returning new content.

This avoids stale pre-read races where actions are planned from an older `vault.read` snapshot and then applied to newer file content.

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

## Gmail Starred

Owning job: [`src/jobs/gmail-starred.ts`](../../src/jobs/gmail-starred.ts).

- Incoming feed = messages with Gmail system label `STARRED` only; connect/disconnect is the v1 include control
- Identity: Gmail message `id` (API documents immutable) → `source: gmail-starred`; thread id is for web links only
- Title: `Subject (Sender)`; link: `https://mail.google.com/mail/u/0/#all/{threadId}` (Gmail UI opens the thread, not a single message)
- Soft-cap: list up to `min(200, gmailStarredMaxItems * 2)` candidate ids, metadata-get those only, sort by `internalDate` desc, then keep newest `gmailStarredMaxItems` (default 100, max 200) within that window — not globally exact newest-N across the whole mailbox
- Unstar in Gmail → line removed on next sync unless Obsidian line is already `[x]` (completed-preserve)
- Delete a synced line in Obsidian while still starred in Gmail → line reappears on next sync (Outlook parity; no `manuallyDeletedTaskIds` equivalent)
- `syncCompletionStatus`: checking/unchecking in Obsidian unstars/re-stars in Gmail on the next sync
- Separate `gmailStarred` credentials from Google Tasks; disconnect clears only Gmail Starred tokens

## Azure DevOps

Owning job: [`src/jobs/azure-devops.ts`](../../src/jobs/azure-devops.ts).

- Incoming feed = work items **assigned to the connected user** in one selected project (WIQL + chunked detail fetch in `src/services/azure-devops.ts`)
- One connected organisation per settings profile; reconnect (disconnect + connect) to switch org
- Checkbox in Obsidian is **local-only** — no write-back to Azure DevOps work item state in #35
- Empty assignment set passes an empty incoming list → stale unchecked Azure DevOps lines are removed; completed lines preserved via `shouldPreserveCompletedDeletes`
- Auth: PAT only (Basic auth with `:${PAT}`), using manual organisation + project fields

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
