# Gotchas

## Build / env

- Client IDs are **build-time** injects via `esbuild.config.mjs` → `process.env` → `pluginSchema`
- Dev: `GOOGLE_CLIENT_ID_DEV` required; `MICROSOFT_CLIENT_ID_DEV` optional (Outlook Connect disabled if omitted)
- Prod: `GOOGLE_CLIENT_ID_PROD` and `MICROSOFT_CLIENT_ID_PROD` both required (fail the build if either is missing)
- See [`.env.example`](../../.env.example) for dev client IDs; prod vars are in README / build scripts / GitHub Actions (`development` / `production` environment secrets)
- Vault install: `npm run sync` needs `OBSIDIAN_VAULT_PLUGIN_DIR_DEV` (see `.envrc.example`); copies `main.js`, `manifest.json`, `styles.css`, and `sql-wasm.wasm`

## Auth realities

- Google: localhost redirect + UWP-style public client ID (no PKCE in `src/auth/google.ts`). README “PKCE” wording is misleading
- Microsoft: Auth Code + PKCE; uses Obsidian `requestUrl` for token POSTs
- Google services still use global `fetch` in places; prefer matching the style of the file you touch

## Sync / UI traps

- Sync reads the **saved file on disk** — unsaved editor buffers are ignored for Manual sync
- Target heading input is normalised to H2 (`## …`)
- SyncGuard + file-content cache interaction is load-bearing; changing delete-detection without understanding it causes false delete prompts
- Known issues tracked in [`TODO.md`](../../TODO.md) (not duplicated here), including:
  - List deselect can trigger Google delete-sync prompts incorrectly
  - HTML `--` inside task URLs can break Kanban metadata comments
  - Incomplete barrels / inconsistent import style

## Firefox Bookmarks

- Copy `sql-wasm.wasm` alongside `main.js` when installing manually (esbuild copies it on build)
- sql.js loader: [`src/services/sql-js-loader.ts`](../../src/services/sql-js-loader.ts) resolves WASM from the plugin directory via `__dirname` in [`plugin-directory.ts`](../../src/plugin/plugin-directory.ts) (not `manifest.dir`, which may be empty)
- Profile auto-detect scans standard paths plus Snap/Flatpak on Linux; manual profile path always wins
- Copy-on-read of `places.sqlite` (+ `-wal`/`-shm` when present) into a unique temp dir; cleaned in `finally`
- Stale selected folder GUIDs → soft warning; valid folders still sync

## Agent pitfalls

- Do not assume every integration is exported from barrel `index.ts` files
- Product rules live in job comments and `sync-semantics.md` — README is user-facing, not the reconcile oracle
- OAuth uses a localhost redirect (desktop-oriented in practice); `manifest.json` currently has `"isDesktopOnly": false`
