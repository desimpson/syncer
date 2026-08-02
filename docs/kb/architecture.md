# Architecture

Obsidian plugin that pulls external items into a target Markdown note under a configurable H2 heading.

## Layers (`src/`)

| Layer       | Owns                                            | Key entry points                                                                 |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `plugin/`   | Lifecycle, settings UI, vault delete-detection  | `plugin/index.ts`, `settings-tab.ts`, `schemas.ts`                               |
| `sync/`     | Generic reconcile + file I/O (no provider APIs) | `scheduler.ts`, `actions.ts`, `reader.ts`, `writer.ts`, `sync-guard.ts`          |
| `jobs/`     | Per-integration orchestration                   | `google-tasks.ts`, `microsoft-outlook.ts`, `firefox-bookmarks.ts`                |
| `services/` | Provider HTTP clients + local SQLite (Firefox)  | `google-tasks.ts`, `outlook-mail.ts`, `firefox-bookmarks.ts`, `sql-js-loader.ts` |
| `adaptors/` | Source DTO → `SyncItem`                         | `google-tasks.ts`, `microsoft-outlook.ts`, `firefox-bookmarks.ts`                |
| `auth/`     | OAuth connect + token refresh                   | `google.ts`, `microsoft.ts`                                                      |
| `utils/`    | Pure helpers / UI popper                        | `error-formatters.ts`, `heading-formatters.ts`, …                                |

Path alias: `@/*` → `src/*`. Bundle entry: `esbuild.config.mjs` → `src/plugin/index.ts` → `main.js`.

## Sync pipeline

```
onload (plugin/index.ts)
  → createGoogleTasksJob / createMicrosoftOutlookJob / createFirefoxBookmarksJob
  → wrap each job in SyncGuard (suppress delete-detection during writes)
  → createScheduler(jobs).start(syncIntervalMinutes)
       │
       ├─ interval + immediate runJobs()
       └─ Manual sync command → scheduler.restart()
```

**Per job (typical):**

1. Load settings; no-op if not connected / not configured
2. Refresh access token if expired (`auth/*`); on `InvalidGrantError` clear credentials + show auth-expired modal
3. Resolve sync file via vault
4. **Services** fetch remote items
5. **Adaptors** map to `SyncItem[]`
6. **Reader** parse existing Markdown items for that `source`
7. Optional Obsidian → remote completion push
8. **Actions** `generateSyncActions` → create/update/delete (with preserve filters)
9. **Writer** apply actions; append creates under target heading (Kanban-aware)

Side path (Google Tasks only): vault `modify` listener in `plugin/index.ts` may delete Google Tasks remotely when lines disappear (`enableDeleteSync`). `handleFileModification` filters `source === "google-tasks"` — Outlook and Firefox have no equivalent delete-sync path today.

## Core types

- `SyncItem` / `SyncAction` / `SyncSource` — [`src/sync/types.ts`](../../src/sync/types.ts)
- `SyncJob` / `SyncJobCreator` — [`src/jobs/types.ts`](../../src/jobs/types.ts)
- Sources today: `"google-tasks"`, `"microsoft-outlook"`, `"firefox-bookmarks"`
