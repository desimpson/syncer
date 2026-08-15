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

## Reconcile contract

- New integrations must write through `reconcileSyncSourceAtomically` in `src/sync/writer.ts`
- Do not do `vault.read` → `generateSyncActions` → later write as separate steps
- If a job needs pre-read state for integration-specific side effects (for example completion push), still run final reconcile/write through the atomic sync API

## Zod and types

- Validate settings, API payloads, and Markdown metadata with Zod (`*Schema` in nearby `schemas.ts`)
- Prefer `z.infer<typeof …Schema>` for types
- Parse at boundaries (`pluginSchema.parse(process.env)`, `pluginSettingsSchema.parse`, service responses)

## Naming

- Factories: `createXJob`, `createScheduler`, `createPopper`
- Mapping: `mapXToSyncItem`
- Schemas: `*Schema`
- Source strings: `"google-tasks"`, `"gmail-starred"`, `"microsoft-outlook"`, `"microsoft-to-do"`, `"firefox-bookmarks"`, `"azure-devops"`, `"todoist"`
- British spelling in identifiers: `normalise`, `initialise`

## Errors and UX

- Domain errors: `InvalidGrantError`, `GraphAuthorizationError`, `GraphRateLimitError`, `GmailAuthorizationError`, `GmailRateLimitError`
- Jobs: on invalid grant, clear credentials and surface `AuthorizationExpiredModal(app, integrationName)` — copy names both **Syncer** and the integration (e.g. `"Microsoft To Do"`) so users know which plugin settings to open
- Scheduler: log job failures with `formatLogError`; do not fail the whole schedule on one job
- UI: `Notice` + `formatUiError`

## Tests

See [docs/testing.md](../testing.md):

- `tests/unit/` — pure, no I/O mocks
- `tests/integration/` — HTTP/vault/DOM/timer mocks; shared stub `tests/integration/mocks/obsidian.ts`
- Mirror `src/` area under `tests/{unit,integration}/…`
- Coverage floors live in `vitest.config.ts` (`thresholds.lines` / `thresholds.branches`); vs-main baseline JSON lives on the orphan `badges` branch — see [docs/testing.md](../testing.md)
- Property-based tests are optional and **targeted**: use them for high-value sync invariants in `sync/` (reconcile actions, markdown parse/write stability), not broad suite-wide fuzzing
- Keep property-based coverage reined in for project size: a small set of invariant-focused tests beats many slow or noisy generators
- Contract checks should stay boundary-first (Zod at settings/API/markdown boundaries) plus occasional critical internal invariants; avoid heavy per-function DbC boilerplate

## Imports

Barrels exist but are incomplete (e.g. `jobs/index.ts` / `services/index.ts` export Google only). Prefer the import style already used in the file you edit; do not mass-migrate to barrels unless asked.

## Issue minimum bar

When creating or refining issues, include at least:

- Problem statement: what user-visible behaviour is wrong/missing
- Scope: affected integration/module and explicit non-goals
- Reproduction steps (for bugs) or workflow context (for enhancements)
- Acceptance criteria: testable checklist of done conditions
- Verification notes: required automated/manual evidence to close

For PR linkage, include `Closes #<issue>` (or `Refs #<issue>` if not closing) in the PR description.

When a PR closes an issue, post test evidence on that issue before merging the PR:

- Link the merged PR
- Include key automated test/build results
- Include manual verification notes for user-visible behaviour

See [checklists.md](checklists.md) for Definition of Done, debug logging policy, integration template, and release smoke checks.
