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
2. parses existing items for the source from the **whole** file snapshot (not only the sync heading — Kanban may move lines to e.g. `## Done`),
3. computes reconcile actions against that same snapshot (`id:source` identity is file-wide),
4. applies updates/deletes/creates before returning new content (new creates still insert under the configured sync heading).

This avoids stale pre-read races where actions are planned from an older `vault.read` snapshot and then applied to newer file content, and avoids re-creating tasks that already exist under another heading.

**Kanban / moved lines:** file-wide identity means an incomplete remote item updates an existing line under e.g. `## Done` in place (checkbox can become `[ ]`) instead of creating a duplicate under the sync heading. With `syncCompletionStatus` **off** (default), Syncer does **not** push local `[x]` to the provider first — enable that setting if Kanban Done cards should write completion remote-ward before reconcile.

## Sync document prepare (once per tick)

[`prepareSyncDocumentForRun`](../../src/sync/prepare-sync-document.ts) runs once at the start of each scheduler tick (before any job):

1. **Save** the sync note when it is open with unsaved edits in any saveable file view — Markdown or Kanban (`saveSyncDocumentIfDirty` in `plugin/save-sync-document.ts`)
2. **Wait for stability** — poll until consecutive on-disk snapshots match (content fingerprint + mtime)
3. If stable → jobs reconcile against that settled file
4. If still unstable or prepare I/O fails → Notice and **skip all jobs** for that tick (scheduler does not throw)

Guaranteed when prepare succeeds: jobs read a **saved, stable** on-disk note; remote items absent from that note get `create` again (e.g. delete line → immediate Manual sync). Not guaranteed: provider APIs return every remote item; true no-diff syncs still no-op; `manuallyDeletedTaskIds` still suppress re-add.

## Google Tasks

Owning job: [`src/jobs/google-tasks.ts`](../../src/jobs/google-tasks.ts).

- Incoming feed = **incomplete** tasks from selected lists only
- Completing a task in Google drops it from the feed → line removed on next sync unless the Obsidian line is already `[x]` (completed-preserve filters on `action.item.completed`)
- `syncCompletionStatus`: push Obsidian checkbox changes to Google; uncomplete-in-Obsidian can restore a task completed in Google
- `enableDeleteSync` (default **off**): vault line removal can delete the Google task in Google Tasks; `confirmDeleteSync` (default **on** when enabled) prompts before remote delete
- **SyncGuard** (`plugin/index.ts`): skip delete-detection while scheduled sync writes the file
- **`manuallyDeletedTaskIds`**: prevent re-adding tasks the user deleted from Obsidian on a later sync
- Deselecting a list drops those task IDs from incoming → delete actions for unmatched items file-wide by `id:source`; completed lines preserved via `shouldPreserveCompletedDeletes`

## Microsoft To Do

Owning job: [`src/jobs/microsoft-todo.ts`](../../src/jobs/microsoft-todo.ts).

- Mirrors Google Tasks list + completion semantics (see Google Tasks section above)
- Incoming feed = **incomplete** tasks from selected To Do lists only (`fetchMicrosoftToDoTasks` in `src/services/microsoft-todo.ts`)
- Completing a task in To Do drops it from the feed → unchecked Obsidian line removed on next sync; **Syncer does not auto-check `[x]`** for remote completions (same deliberate tradeoff as Google Tasks)
- `[x]` lines preserved via `shouldPreserveCompletedDeletes`
- `syncCompletionStatus`: push Obsidian checkbox changes to To Do; uncomplete-in-Obsidian can restore a task completed in To Do (job also fetches completed tasks for `taskId → listId` mapping)
- Deselecting a list or disconnecting: unmatched unchecked lines removed; completed preserved; disconnect clears `microsoftToDo` settings only (Outlook unaffected)
- No vault→remote delete in v1; separate OAuth token from Outlook (Tasks scopes)

## Todoist

Owning job: [`src/jobs/todoist.ts`](../../src/jobs/todoist.ts).

- Mirrors Microsoft To Do project/list + completion semantics
- Incoming feed = **active (incomplete)** tasks from selected projects only (`fetchTodoistTasks` in `src/services/todoist.ts` against **api/v1**)
- Completing a task in Todoist drops it from the feed → unchecked Obsidian line removed on next sync; **Syncer does not auto-check `[x]`** for remote completions
- `[x]` lines preserved via `shouldPreserveCompletedDeletes`
- `syncCompletionStatus`: push Obsidian checkbox changes via `POST …/tasks/{id}/close` and `…/reopen`
- Deselecting a project or disconnecting: unmatched unchecked lines removed; completed preserved; disconnect clears `todoist` settings only and shows a Notice that existing lines remain
- No vault→remote delete in v1; OAuth (PKCE public client) with tokens in `data.json`

## Microsoft Outlook

Owning job: [`src/jobs/microsoft-outlook.ts`](../../src/jobs/microsoft-outlook.ts).

- Incoming feed = messages with Outlook follow-up flag `flagged` only (`fetchFlaggedMessages` in `src/services/outlook-mail.ts`); unflagged or `complete` messages drop out on the next sync
- `syncCompletionStatus`: checking/unchecking in Obsidian updates the Outlook flag on the next sync
- Account kind + optional Entra tenant ID → tenant segment for Graph auth

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
- Reads `places.sqlite` via copy-on-read + **sql.js** (WASM bundled into `main.js`)
- While Firefox is open (`-wal` present), hot-copy merges WAL via `sqlite3` CLI or Python (no `-shm` copy) before sql.js opens; if merge fails, sync may miss newest bookmarks (notice asks to close Firefox briefly)
- Desktop only (`Platform.isDesktopApp`); settings hidden on mobile

## SyncGuard

[`src/sync/sync-guard.ts`](../../src/sync/sync-guard.ts), wired in [`plugin/index.ts`](../../src/plugin/index.ts):

- Suppresses delete-detection while a job writes the file
- Content cache refreshed **before** guard release so post-sync `modify` events see no spurious deletions
