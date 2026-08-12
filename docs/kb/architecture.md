# Architecture

Obsidian plugin that pulls external items into a target Markdown note under a configurable H2 heading.

Path alias: `@/*` → `src/*`. Bundle: `esbuild.config.mjs` → `src/plugin/index.ts` → `main.js`.

Hard constraints: no provider HTTP in `sync/`; no Obsidian APIs in `services/` or `adaptors/`; jobs write only via `reconcileSyncSourceAtomically` ([`src/sync/writer.ts`](../../src/sync/writer.ts)).

## Layers (`src/`)

| Layer       | Owns                                           |
| ----------- | ---------------------------------------------- |
| `plugin/`   | Lifecycle, settings UI, vault delete-detection |
| `sync/`     | Scheduler, prepare, reader/writer, sync-guard  |
| `jobs/`     | Per-source orchestration                       |
| `services/` | Provider HTTP + Firefox SQLite                 |
| `adaptors/` | DTO → `SyncItem`                               |
| `auth/`     | OAuth connect + refresh                        |
| `utils/`    | Pure helpers                                   |

Entry points: `plugin/{index,save-sync-document}.ts`, `sync/{scheduler,prepare-sync-document,writer,reader,sync-guard}.ts`, `jobs/*`, `services/*`, `adaptors/*`, `auth/{google,microsoft,azure-devops}.ts`.

## Module map

```mermaid
flowchart TB
  plugin["plugin/ — lifecycle, settings, delete-detection, save-sync-document"]
  scheduler["sync/scheduler — sequential interval + manual sync"]
  prepare["sync/prepare-sync-document — save-if-dirty + waitForStable"]
  guard["sync/sync-guard — suppress delete-detection during writes"]
  jobs["jobs/ — one SyncJob per source"]
  auth["auth/ — OAuth connect + refresh"]
  services["services/ — provider HTTP / Firefox SQLite"]
  adaptors["adaptors/ — DTO → SyncItem"]
  writer["sync/writer — atomic reconcile"]
  vault["Obsidian vault — target Markdown note"]
  external["External APIs / local Firefox DB"]

  plugin --> scheduler
  plugin --> prepare
  plugin --> guard
  scheduler -->|beforeRun once per tick| prepare
  prepare --> vault
  scheduler --> jobs
  guard -.-> jobs
  jobs --> auth
  jobs --> services
  services --> external
  services --> adaptors
  adaptors --> jobs
  jobs --> writer
  writer --> vault
  plugin -.->|Google Tasks delete-sync only| vault
```

## Sync bootstrap

```mermaid
flowchart TD
  onload["plugin onload"] --> createJobs["create*Job for each source"]
  createJobs --> wrap["wrap each job in SyncGuard"]
  wrap --> start["createScheduler(jobs, beforeRun).start(interval)"]
  start --> prepare["beforeRun: save dirty view + waitForStable"]
  prepare -->|stable| run["runJobs — await jobs one-after-another"]
  prepare -->|unstable / I/O error| skip["Notice and skip jobs for tick"]
  start --> interval["interval timer → runJobs"]
  start --> manual["manual sync command → scheduler.restart"]
```

Jobs run sequentially: each `vault.process`es the same note; parallel runs race and drop creates. Prepare runs once per tick (shared `syncDocument`) before any job.

## One job cycle

```mermaid
sequenceDiagram
  participant Scheduler
  participant Prepare as sync/prepare
  participant Job as jobs/*
  participant Auth as auth/*
  participant Service as services/*
  participant Adaptor as adaptors/*
  participant Writer as sync/writer
  participant Vault as Obsidian vault

  Scheduler->>Prepare: beforeRun (once per tick)
  Prepare->>Vault: save open dirty view if needed
  Prepare->>Vault: waitForStable snapshot
  Scheduler->>Job: task()
  Job->>Auth: refresh token if expired
  Job->>Service: fetch remote items
  Service-->>Adaptor: provider DTOs
  Adaptor-->>Job: SyncItem[]
  opt completion push
    Job->>Service: Obsidian → remote status
  end
  Job->>Writer: reconcileSyncSourceAtomically()
  Writer->>Vault: vault.process snapshot
  Writer->>Writer: plan create / update / delete
  Writer->>Vault: apply in same callback
```

Side path (Google Tasks only): vault `modify` in `plugin/index.ts` may delete remote tasks when lines disappear (`enableDeleteSync`). Other sources have no vault→remote delete path today.

## Core types

- `SyncItem` / `SyncAction` / `SyncSource` — [`src/sync/types.ts`](../../src/sync/types.ts)
- `SyncJob` / `SyncJobCreator` — [`src/jobs/types.ts`](../../src/jobs/types.ts)
- Sources: `"google-tasks"`, `"gmail-starred"`, `"microsoft-to-do"`, `"microsoft-outlook"`, `"azure-devops"`, `"firefox-bookmarks"`
