# Conventions

Match existing patterns; do not invent a second style.

## Layering

| Allowed                                                     | Forbidden                                   |
| ----------------------------------------------------------- | ------------------------------------------- |
| Provider HTTP in `services/`                                | Provider HTTP in `sync/`                    |
| Obsidian vault/file types in `jobs/` and sync reader/writer | Obsidian APIs in `services/` or `adaptors/` |
| UI, modals, settings in `plugin/` only                      | Business reconcile in adaptors              |
| DTO → `SyncItem` in `adaptors/`                             | —                                           |

Jobs glue auth + services + adaptors + sync. Plugin owns lifecycle, settings, and delete-detection UI.

## Zod and types

- Validate settings, API payloads, and Markdown metadata with Zod (`*Schema` in nearby `schemas.ts`)
- Prefer `z.infer<typeof …Schema>` for types
- Parse at boundaries (`pluginSchema.parse(process.env)`, `pluginSettingsSchema.parse`, service responses)

## Naming

- Factories: `createXJob`, `createScheduler`, `createPopper`
- Mapping: `mapXToSyncItem`
- Schemas: `*Schema`
- Source strings: `"google-tasks"`, `"microsoft-outlook"`, `"firefox-bookmarks"`
- British spelling in identifiers: `normalise`, `initialise`

## Errors and UX

- Domain errors: `InvalidGrantError`, `GraphAuthorizationError`
- Jobs: on invalid grant, clear credentials and surface `AuthorizationExpiredModal`
- Scheduler: log job failures with `formatLogError`; do not fail the whole schedule on one job
- UI: `Notice` + `formatUiError`

## Tests

See [docs/testing.md](../testing.md):

- `tests/unit/` — pure, no I/O mocks
- `tests/integration/` — HTTP/vault/DOM/timer mocks; shared stub `tests/integration/mocks/obsidian.ts`
- Mirror `src/` area under `tests/{unit,integration}/…`

## Imports

Barrels exist but are incomplete (e.g. `jobs/index.ts` / `services/index.ts` export Google only). Prefer the import style already used in the file you edit; do not mass-migrate to barrels unless asked.
