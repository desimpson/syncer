# Sync semantics

Product rules that are easy to break. Owning code is the authority; keep this page aligned when jobs/writer change.

## Markdown item format

Written by [`src/sync/writer.ts`](../../src/sync/writer.ts):

```text
- [ ] [title](link) <!-- {"id","source","title","link","heading"} -->
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
- Completing a task in Google drops it from the feed → line removed on next sync (unless completed-preserve applies)
- `syncCompletionStatus`: push Obsidian checkbox changes to Google; uncomplete-in-Obsidian can restore a task completed in Google
- `enableDeleteSync`: vault line removal can delete the Google task (confirmation optional); uses `manuallyDeletedTaskIds` / SyncGuard to avoid false prompts during scheduled sync
- Deselecting a list removes matching items under the target heading on next sync; items moved elsewhere in the note may be preserved (see job + TODO.md)

## Microsoft Outlook

Owning job: [`src/jobs/microsoft-outlook.ts`](../../src/jobs/microsoft-outlook.ts).

- Syncs messages with Outlook follow-up flag = flagged
- `syncCompletionStatus`: checking/unchecking in Obsidian updates the Outlook flag on next sync
- Account kind + optional Entra tenant ID → tenant segment for Graph auth

## SyncGuard

[`src/sync/sync-guard.ts`](../../src/sync/sync-guard.ts), wired in [`plugin/index.ts`](../../src/plugin/index.ts):

- Suppresses delete-detection while a job writes the file
- Content cache refreshed **before** guard release so post-sync `modify` events see no spurious deletions
