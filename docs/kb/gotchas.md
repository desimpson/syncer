# Gotchas

## Build / env

- Client IDs are **build-time** injects via `esbuild.config.mjs` → `process.env` → `pluginSchema`
- Dev: `GOOGLE_TASKS_CLIENT_ID_DEV` required; `OUTLOOK_CLIENT_ID_DEV` optional (Outlook Connect disabled if omitted)
- Prod: `GOOGLE_TASKS_CLIENT_ID_PROD` and `OUTLOOK_CLIENT_ID_PROD` both required (fail the build if either is missing)
- See [`.env.example`](../../.env.example) for dev client IDs; prod vars are in README / build scripts / GitHub Actions (`development` / `production` environment secrets)
- Vault install: `npm run sync` needs `OBSIDIAN_VAULT_PLUGIN_DIR_DEV` (see `.envrc.example`); copies `main.js`, `manifest.json`, `styles.css`, and `sql-wasm.wasm`

## Auth realities

- Google: localhost redirect + UWP-style public client ID (no PKCE in `src/auth/google.ts`). README “PKCE” wording is misleading
- Microsoft: Auth Code + PKCE; uses Obsidian `requestUrl` for token POSTs
- Azure DevOps uses PAT mode only: Basic auth with `:${PAT}`; requires organisation + project name settings and a PAT with Work Items read scope
- Azure DevOps org name is a separate settings field (URL segment from `https://dev.azure.com/{org}`); consent/tenant mismatches often show as project-list or WIQL auth failures
- Google services still use global `fetch` in places; prefer matching the style of the file you touch

## Sync / UI traps

- Sync reads the **saved file on disk** — unsaved editor buffers are ignored for Manual sync
- Target heading input is normalised to H2 (`## …`)
- Scheduler runs jobs **sequentially** ([`scheduler.ts`](../../src/sync/scheduler.ts)) — parallel `vault.process` on the same note races and drops creates (looked like “Firefox missed a bookmark”)
- Job reconcile planning must be atomic (`reconcileSyncSourceAtomically` in [`writer.ts`](../../src/sync/writer.ts)); pre-read action planning can miss creates when the file changes before write
- SyncGuard + file-content cache interaction is load-bearing; changing delete-detection without understanding it causes false delete prompts
- Known issues tracked in [`TODO.md`](../../TODO.md) (not duplicated here), including:
  - List deselect can trigger Google delete-sync prompts incorrectly
  - HTML `--` inside task URLs can break Kanban metadata comments
  - Incomplete barrels / inconsistent import style

## Firefox Bookmarks

- Copy `sql-wasm.wasm` alongside `main.js` when installing manually (esbuild copies it on build)
- sql.js loader: [`src/services/sql-js-loader.ts`](../../src/services/sql-js-loader.ts) resolves WASM via [`plugin-directory.ts`](../../src/plugin/plugin-directory.ts) — join vault `FileSystemAdapter.getBasePath()` with vault-relative `manifest.dir`. Do **not** use `__dirname` (points at Electron asar in Obsidian)
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
- OAuth uses a localhost redirect (desktop-oriented in practice); `manifest.json` currently has `"isDesktopOnly": false`
