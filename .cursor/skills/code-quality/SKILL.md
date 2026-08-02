---
name: code-quality
description: Maintain Syncer code quality using project layering, Zod schemas, naming, error handling, and the unit/integration test split. Use when implementing features, refactoring, reviewing changes, or when the user asks to keep quality high.
---

# Code quality

Project-specific checklist. Read [`docs/kb/conventions.md`](docs/kb/conventions.md) for detail.

## Layers

- `auth/` — OAuth connect + token refresh (no reconcile or file I/O)
- `services/` — HTTP / provider APIs only
- `adaptors/` — DTO → `SyncItem` mapping only
- `sync/` — reconcile + Markdown I/O; no provider APIs
- `jobs/` — glue (auth, fetch, map, reconcile, write)
- `plugin/` — Obsidian lifecycle, settings, delete-detection UI

## Implementation

- Validate at boundaries with Zod (`*Schema`); prefer `z.infer`
- Names: `createXJob`, `mapXToSyncItem`, source strings `"google-tasks"` / `"microsoft-outlook"`
- British spelling already in repo: `normalise`, `initialise`
- Errors: domain types + `formatUiError` / `formatLogError`; follow existing invalid-grant clear-credentials pattern in jobs
- Match import style of the file you edit (barrels are incomplete — do not mass-migrate)

## Tests

Follow [`docs/testing.md`](docs/testing.md):

- Pure logic → `tests/unit/…`
- Vault/HTTP/DOM/timer mocks → `tests/integration/…`
- Mirror the `src/` area path

## Scope

- Change only what the task requires
- Do not drive-by fix unrelated TODOs
- If sync product rules change, also apply `update-knowledge-base`
