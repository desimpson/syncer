# Architecture

Obsidian plugin that pulls external items into a target Markdown note under a configurable H2 heading.

## Layers (`src/`)

| Layer       | Owns                                            | Key entry points                                                                                                                               |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin/`   | Lifecycle, settings UI, vault delete-detection  | `plugin/index.ts`, `settings-tab.ts`, `schemas.ts`, `plugin-directory.ts`                                                                      |
| `sync/`     | Generic reconcile + file I/O (no provider APIs) | `scheduler.ts`, `actions.ts`, `reader.ts`, `writer.ts`, `sync-guard.ts`                                                                        |
| `jobs/`     | Per-integration orchestration                   | `google-tasks.ts`, `gmail-starred.ts`, `microsoft-outlook.ts`, `azure-devops.ts`, `firefox-bookmarks.ts`                                       |
| `services/` | Provider HTTP clients + local SQLite (Firefox)  | `google-tasks.ts`, `gmail-starred.ts`, `outlook-mail.ts`, `azure-devops.ts`, `firefox-bookmarks.ts`, `firefox-profiles.ts`, `sql-js-loader.ts` |
| `adaptors/` | Source DTO → `SyncItem`                         | `google-tasks.ts`, `gmail-starred.ts`, `microsoft-outlook.ts`, `azure-devops.ts`, `firefox-bookmarks.ts`                                       |
| `auth/`     | OAuth connect + token refresh                   | `google.ts`, `microsoft.ts`, `azure-devops.ts`                                                                                                 |
| `utils/`    | Pure helpers / UI popper                        | `error-formatters.ts`, `heading-formatters.ts`, …                                                                                              |

Path alias: `@/*` → `src/*`. Bundle entry: `esbuild.config.mjs` → `src/plugin/index.ts` → `main.js` (with sql.js WASM embedded).

## Sync pipeline

```
onload (plugin/index.ts)
  → createGoogleTasksJob / createGmailStarredJob / createMicrosoftOutlookJob / createAzureDevOpsJob / createFirefoxBookmarksJob
  → wrap each job in SyncGuard (suppress delete-detection during writes)
  → createScheduler(jobs).start(syncIntervalMinutes)
       │
       ├─ interval + immediate runJobs() (jobs await one-after-another)
       └─ Manual sync command → scheduler.restart()
```

Jobs must stay sequential: each job `vault.process`es the same sync note; `Promise.all` lost updates.

**Per job (typical):**

1. Load settings; no-op if not connected / not configured
2. Refresh access token if expired (`auth/*`); on `InvalidGrantError` clear credentials + show auth-expired modal
3. Resolve sync file via vault
4. **Services** fetch remote items
5. **Adaptors** map to `SyncItem[]`
6. Optional pre-read for integration-specific logic (for example completion push)
7. Optional Obsidian → remote completion push
8. **Writer** `reconcileSyncSourceAtomically` computes actions from the `vault.process` snapshot
9. **Writer** applies updates/deletes/creates in the same `vault.process` callback

Atomic reconcile in `src/sync/writer.ts` is the default job write contract for all integrations. Jobs must not plan actions from a stale `vault.read` snapshot and then write later.

Side path (Google Tasks only): vault `modify` listener in `plugin/index.ts` may delete Google Tasks remotely when lines disappear (`enableDeleteSync`). `handleFileModification` filters `source === "google-tasks"` — Outlook and Firefox have no equivalent delete-sync path today.

## Core types

- `SyncItem` / `SyncAction` / `SyncSource` — [`src/sync/types.ts`](../../src/sync/types.ts)
- `SyncJob` / `SyncJobCreator` — [`src/jobs/types.ts`](../../src/jobs/types.ts)
- Sources today: `"google-tasks"`, `"gmail-starred"`, `"microsoft-outlook"`, `"azure-devops"`, `"firefox-bookmarks"`
