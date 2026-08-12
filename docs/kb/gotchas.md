# Gotchas

## Build / env

- Client IDs are **build-time** injects via `esbuild.config.mjs` → `process.env` → `pluginSchema`
- Dev: `GOOGLE_CLIENT_ID_DEV` required; `MICROSOFT_CLIENT_ID_DEV` optional (Outlook Connect disabled if omitted)
- Prod: `GOOGLE_CLIENT_ID_PROD` and `MICROSOFT_CLIENT_ID_PROD` both required (fail the build if either is missing)
- See [`.env.example`](../../.env.example) for dev client IDs; prod vars are in README / build scripts / GitHub Actions (`development` / `production` environment secrets)
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

## Agent pitfalls

- Do not assume every integration is exported from barrel `index.ts` files
- Product rules live in job comments and `sync-semantics.md` — README is user-facing, not the reconcile oracle
- OAuth uses a localhost redirect + Node modules, so `manifest.json` must stay aligned with desktop-only behavior (`"isDesktopOnly": true`)
