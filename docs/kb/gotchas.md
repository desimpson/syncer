# Gotchas

## Build / env

- Client IDs are **build-time** injects via `esbuild.config.mjs` → `process.env` → `pluginSchema`
- Dev: `GOOGLE_CLIENT_ID_DEV` required; `MICROSOFT_CLIENT_ID_DEV` and `TODOIST_CLIENT_ID_DEV` optional (Connect disabled if omitted). There is no committed `oauth-clients.dev.json` — Observer only rebuilds prod
- Prod: Google, Microsoft, and Todoist IDs come from committed [`oauth-clients.prod.json`](../../oauth-clients.prod.json) (env `_PROD` vars may override locally). Do not inject those values in `release.yml` or CI `build-prod` — Observer rebuilds must match a clean checkout
- That file is public client IDs only. Extra keys fail the prod parse (`productionOAuthClientsSchema` is `.strict()` in [`esbuild.config.mjs`](../../esbuild.config.mjs)); [`scripts/check-oauth-clients.mjs`](../../scripts/check-oauth-clients.mjs) also rejects secret-shaped values. Test & Lint and release both run `npm run check:oauth-clients`
- See [`.env.example`](../../.env.example) for dev client IDs; CI `build-dev` may inject `*_DEV` secrets from the GitHub **`dev`** environment. CI `build-prod` and release use GitHub Environment **`prod`** for deployment records only — no `*_PROD` client-ID secrets
- Vault install: `npm run sync` needs `OBSIDIAN_VAULT_PLUGIN_DIR_DEV` (see `.envrc.example`); copies `main.js`, `manifest.json`, and `styles.css`
- `electron` is an esbuild **external** only ([`esbuild.config.mjs`](../../esbuild.config.mjs)); Obsidian supplies Electron at runtime. Do not re-add it as an npm dependency for typing or audit cosmetics unless the plugin actually imports it

## Auth realities

- Google: localhost redirect + UWP-style public client ID (no PKCE in `src/auth/google.ts`); token and API calls use Obsidian `requestUrl`
- Microsoft: Auth Code + PKCE; uses Obsidian `requestUrl` for token POSTs
- Microsoft To Do reuses the **same Entra app / client ID** as Outlook but requests **Tasks.ReadWrite** (delegated) — add it to the existing app’s API permissions or Connect/consent will fail or Graph To Do calls return 403
- Outlook and To Do store **separate** credential blobs and tokens; shared settings fields `microsoftAuthAccountKind` / `microsoftAuthWorkOrSchoolTenantId` only affect the **next** Connect (each integration persists its own `tenantSegment`)
- To Do deep links use unofficial `to-do.live.com` / `to-do.office.com` patterns (task id URL, list-level fallback) — no runtime probing in v1
- Graph `GET …/todo/lists/{id}/tasks` rejects `$select` (HTTP 400); incomplete feed uses a positive `$filter` OR of non-completed statuses (plus a client-side safety filter) — see `src/services/microsoft-todo.ts`
- Graph **403** on To Do keeps credentials and Notices about `Tasks.ReadWrite` / consent; only **401** clears the To Do blob and opens the expired-auth modal
- To Do Graph failures include a short `error.code` / `error.message` in the Notice via `summariseGraphErrorBody` (truncated; never raw JSON) — useful when Graph rejects unsupported query options
- Azure DevOps uses PAT mode only: Basic auth with `:${PAT}`; requires organisation + project name settings and a PAT with Work Items read scope
- Azure DevOps org name is a separate settings field (URL segment from `https://dev.azure.com/{org}`); consent/tenant mismatches often show as project-list or WIQL auth failures
- Provider HTTP in `auth/` and `services/` should use Obsidian `requestUrl` (not renderer `fetch`) so portal review and CORS stay aligned
- **Todoist API:** use `https://api.todoist.com/api/v1` only — legacy `rest/v2` was retired 2026-02-10 ([shutdown notice](https://groups.google.com/a/doist.com/g/todoist-api/c/brwENjfT_tk)); production returns 410 Gone
- Todoist OAuth: Auth Code + PKCE public client (`token_endpoint_auth_method: none`). Register via `POST https://api.todoist.com/oauth/register` — the App Console only issues confidential clients, and refresh then demands `client_secret`. Loopback redirect URIs `http://localhost:27855/`, `http://localhost:27856/`, `http://localhost:27857/`; Connect tries those ports in order. After changing client ID, Disconnect and Connect again.
- A Connect Notice that those ports are in use is almost always another Syncer window or a leftover listener, not a bad client ID
- Todoist per-project task fetch is **sequential** (rate-limit hygiene); a 404 on one selected project is treated as empty for that project — Refresh prunes stale project IDs but mid-cycle 404 UI lag is expected
- Todoist task links are constructed as `https://app.todoist.com/app/task/{id}` (api/v1 no longer returns `url`)
- Todoist completion write-back uses task id only (`close` / `reopen`); it does not depend on the 90-day completed-tasks listing cap

## Sync / UI traps

- Each scheduler tick **saves** the sync note when open with unsaved edits (any saveable file view, including Kanban — not only `markdown` leaves), then waits for a stable on-disk snapshot before jobs run (`saveSyncDocumentIfDirty` + `prepareSyncDocumentForRun`)
- If the note keeps changing on disk, sync shows a Notice and **skips jobs** for that tick — retry Manual sync shortly rather than reconciling against a stale file
- Target heading input is normalised to H2 (`## …`)
- Scheduler runs jobs **sequentially** ([`scheduler.ts`](../../src/sync/scheduler.ts)) — parallel `vault.process` on the same note races and drops creates (looked like “Firefox missed a bookmark”)
- Job reconcile planning must be atomic (`reconcileSyncSourceAtomically` in [`writer.ts`](../../src/sync/writer.ts)); pre-read action planning can miss creates when the file changes before write
- SyncGuard + file-content cache interaction is load-bearing; changing delete-detection without understanding it causes false delete prompts
- Known issues tracked in [`TODO.md`](../../TODO.md) (not duplicated here), including:
  - List deselect can trigger Google delete-sync prompts incorrectly
  - HTML `--` inside task URLs can break Kanban metadata comments
  - Incomplete barrels / inconsistent import style

## Firefox Bookmarks

- sql.js WASM is bundled into `main.js` by esbuild (`.wasm` binary loader); no separate `sql-wasm.wasm` release asset is required
- Profile auto-detect scans standard paths plus Snap/Flatpak on Linux; manual profile path always wins
- Copy-on-read of `places.sqlite` + `-wal` into a unique temp dir (never copy `-shm` — Firefox’s live WAL index can make merges miss newest frames); cleaned in `finally`
- While Firefox is open, new bookmarks live in the WAL. sql.js cannot read WAL sidecars — merge via `sqlite3 .backup` or Python `sqlite3.Connection.backup` before open. If both fail, sync sees a stale main DB (notice: close Firefox briefly)
- Sync job validates selected folders against the settings snapshot from **Refresh folders**, then opens places once for bookmark fetch (avoids a double hot-copy per sync)
- Do **not** query `moz_bookmarks_roots` — removed in Firefox 31; tags root is `guid = 'tags________'` on `moz_bookmarks` ([`firefox-bookmarks.ts`](../../src/services/firefox-bookmarks.ts))
- Stale selected folder GUIDs → soft warning; valid folders still sync
- Folder picker search ranks shallow title matches first and collapses descendants under a hit (`searchFirefoxBookmarkFolders` in [`firefox-profiles.ts`](../../src/services/firefox-profiles.ts)) — selecting a parent already syncs subfolders recursively
- Outside-vault reads are scoped in [`firefox-fs-guard.ts`](../../src/utils/firefox-fs-guard.ts): basename allowlist, `realpath` containment, and a single process-owned `mkdtemp` temp dir per read (not every `syncer-firefox-*` under shared `/tmp`)

## Release / tags

- Release tags must be **annotated** (`git tag -a` / `npm version`); `git push --follow-tags` ignores lightweight tags, so a version commit can land on `main` without triggering [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
- Verify with `git cat-file -t refs/tags/x.y.z` → `tag`. A detached checkout of the tag target makes `git cat-file -t x.y.z` report `commit` even when the tag is annotated (Actions release job). See README Releasing and [`checklists.md`](checklists.md)

## Public legal site

- Homepage / Privacy / Terms are static files in [`site/`](../../site/), deployed by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) to `https://obsidiansyncer.com`. Do **not** set Pages source to `docs/` — that would publish this KB

## Agent pitfalls

- Do not assume every integration is exported from barrel `index.ts` files
- Product rules live in job comments and `sync-semantics.md` — README is user-facing, not the reconcile oracle
- OAuth uses a localhost redirect + Node modules, so `manifest.json` must stay aligned with desktop-only behavior (`"isDesktopOnly": true`)
