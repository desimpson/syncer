---
name: sync-feature
description: Add or change a Syncer integration (job, service, adaptor, auth) safely through the layered pipeline. Use when adding a sync source, extending Google Tasks or Outlook, or wiring a new job into the scheduler.
---

# Sync feature

## Checklist

Work top-down through the layers that need changes:

1. **Types / source id** — extend `SyncSource` (and constants) in `src/sync/types.ts` if adding a source
2. **Service** — HTTP client + schemas in `src/services/`
3. **Adaptor** — `mapXToSyncItem` in `src/adaptors/`
4. **Auth** (if needed) — connect + refresh in `src/auth/`; settings fields + Zod in `src/plugin/` and `src/auth/`
5. **Job** — `createXJob` implementing `SyncJobCreator` in `src/jobs/`
6. **Plugin wire-up** — register job in `src/plugin/index.ts` inside SyncGuard like existing jobs
7. **Settings UI** — `settings-tab.ts` + `plugin/schemas.ts` / types
8. **Tests** — unit for pure map/schema/actions; integration for job/service/auth with mocks under `tests/{unit,integration}/…`

## Rules

- Reuse `generateSyncActions`, reader/writer, and SyncGuard — do not reimplement reconcile in the job
- Document new product rules in [`docs/kb/sync-semantics.md`](docs/kb/sync-semantics.md)
- Note new modules/wiring in [`docs/kb/architecture.md`](docs/kb/architecture.md)
- New client IDs or env injects → `esbuild.config.mjs`, README, and [`docs/kb/gotchas.md`](docs/kb/gotchas.md)

## Reference implementations

- Google: `src/jobs/google-tasks.ts`, `src/services/google-tasks.ts`, `src/adaptors/google-tasks.ts`, `src/auth/google.ts`
- Outlook: `src/jobs/microsoft-outlook.ts`, `src/services/outlook-mail.ts`, `src/adaptors/microsoft-outlook.ts`, `src/auth/microsoft.ts`
