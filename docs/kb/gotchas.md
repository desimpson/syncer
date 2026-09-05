# Gotchas

## Build / env

- Client IDs are **build-time** injects via `esbuild.config.mjs` named defines (`__GOOGLE_CLIENT_ID__`, etc.) parsed by `src/plugin/build-config.ts`; do not reintroduce whole-object `process.env` define replacement
- Three OAuth JSON files (Google, Microsoft, Todoist only — Azure DevOps PAT and Firefox stay out):
  - **Dev:** gitignored `oauth-clients.dev.json` (copy [`oauth-clients.dev.json.example`](../../oauth-clients.dev.json.example)); empty IDs disable Connect for that provider
  - **Staging:** committed [`oauth-clients.staging.json`](../../oauth-clients.staging.json) — `npm run build:staging`; CI non-`main` artifact build
  - **Prod:** committed [`oauth-clients.prod.json`](../../oauth-clients.prod.json) — `npm run build:prod`, release, and CI `main`
- **Public-by-design:** Microsoft Entra and Todoist client IDs are public; they ship in the bundle. Google Desktop installed-app clients also commit a `GOOGLE_CLIENT_SECRET` in staging/prod JSON; do not treat that as a hidden server secret — it is bundled-adjacent config checked into the repo for clean-checkout builds (exact strings allowlisted in [`.gitleaks.toml`](../../.gitleaks.toml) via [#185](https://github.com/desimpson/syncer/issues/185)). Local dev needs both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in gitignored `oauth-clients.dev.json`; Connect is disabled when either is empty
- **Do not cross-use clients between environments** — each env has its own GCP / Entra / Todoist app; using prod creds in dev (or vice versa) breaks consent, redirect URIs, and rollback
- Extra keys fail the build parse (`oauthClientsSchema` is `.strict()` in [`esbuild.config.mjs`](../../esbuild.config.mjs)); [`scripts/check-oauth-clients.mjs`](../../scripts/check-oauth-clients.mjs) validates committed staging + prod JSON. Test & Lint and release both run `npm run check:oauth-clients`
- Build mode comes from `BUILD_ENV=dev|staging|prod` (watch uses `BUILD_ENV=dev` + `--watch`); `prod` compiles with `__ENABLE_GOOGLE__=false` so Google Connect is intentionally disabled in production bundles
- See [`oauth-clients.dev.json.example`](../../oauth-clients.dev.json.example) for local dev shape. CI `build-staging` and `build-prod` use GitHub Environments **`staging`** / **`prod`** as empty deployment gates — no OAuth secrets injected
- Vault install: `npm run sync` needs `OBSIDIAN_VAULT_PLUGIN_DIR_DEV` (see `.envrc.example`); copies `main.js`, `manifest.json`, and `styles.css`
- `electron` is an esbuild **external** only ([`esbuild.config.mjs`](../../esbuild.config.mjs)); Obsidian supplies Electron at runtime. Do not re-add it as an npm dependency for typing or audit cosmetics unless the plugin actually imports it

## Auth realities

- **GCP project IDs (canonical, #110):** staging → `obsidiansyncer-staging`, prod → `obsidiansyncer-prod`. `obsidiansyncer-dev` is the **maintainer’s personal** Google Connect project (not in the repo). Dev client IDs/secrets stay local in gitignored `oauth-clients.dev.json` — contributors who want Google Connect create their own GCP project + Desktop client. Consent names (#130): `Syncer Dev` / `Syncer Staging` / `Syncer`. One **Desktop** client per project (not UWP/Web). Old rollback projects `obsidian-syncer-development` / `obsidian-syncer-production` stay active until #194. After migrating to a new Desktop client, users must **Disconnect then Connect** — old UWP-bound refresh tokens fail refresh with `invalid_grant`
- Google: Auth Code + **PKCE (S256)** + Desktop **client_secret** on token exchange and refresh ([`src/auth/google.ts`](../../src/auth/google.ts)); localhost redirect; token and API calls use Obsidian `requestUrl`
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
- Todoist OAuth: Auth Code + PKCE public client (`token_endpoint_auth_method: none`). Register via `POST https://api.todoist.com/oauth/register` with `logo_uri` `https://obsidiansyncer.com/logo.png` — the App Console only issues confidential clients, and refresh then demands `client_secret`. No DCR update API: re-register to change the icon, then swap the client ID. Loopback redirect URIs `http://localhost:27855/`, `http://localhost:27856/`, `http://localhost:27857/`; Connect tries those ports in order. After changing client ID, Disconnect and Connect again.
- OAuth consent icon is the same mark everywhere: vector [`site/favicon.svg`](../../site/favicon.svg), 512² [`site/logo.png`](../../site/logo.png) (Todoist `logo_uri` and Google/Entra upload), 300² export [`docs/branding/logo-300.png`](../branding/logo-300.png). Do not invent a second mark.
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
- Connected Google Tasks / Microsoft To Do / Todoist / Firefox with no lists/projects/folders selected → jobs no-op silently (no Notice on periodic sync); Settings shows “Nothing will sync until you select at least one …”
- Known issues tracked in [`TODO.md`](../../TODO.md) (not duplicated here), including:
  - List deselect can trigger Google delete-sync prompts incorrectly
  - HTML `--` inside task URLs can break Kanban metadata comments
  - Incomplete barrels / inconsistent import style

## Firefox Bookmarks

- sql.js WASM is bundled into `main.js` by esbuild (`.wasm` binary loader); no separate `sql-wasm.wasm` release asset is required
- Profile auto-detect scans `~/.mozilla/firefox` first, then `~/.config/mozilla/firefox` (XDG), plus Snap/Flatpak. If none are accessible, Refresh folders shows profile-not-found (not a raw path-guard error). Manual path always wins. Runtime paths rely on native `process.env`; do not reintroduce whole-object `process.env` define replacement in the bundler.
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

- Homepage / Privacy / Terms are static files in [`site/`](../../site/), deployed by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) to `https://obsidiansyncer.com`. Do **not** set Pages source to `docs/` — that would publish this KB. Do **not** deploy `coverage/` HTML through Pages either

## Coverage badges and CI gates

- **Gitleaks** — [`.github/workflows/gitleaks.yml`](../../.github/workflows/gitleaks.yml) runs on `pull_request` and `push` (not `badges`). The action scans only the event commit range via `--log-opts` (PR/push), not full git history. Do not add `schedule` or `workflow_dispatch` until [#38](https://github.com/desimpson/syncer/issues/38) (those modes scan all history). Custom rule `google-oauth-installed-app-secret` in [`.gitleaks.toml`](../../.gitleaks.toml) detects `GOCSPX-…`. Committed staging/prod Desktop secrets are allowlisted there and in [`.gitleaksignore`](../../.gitleaksignore) (needed for CI’s gitleaks 8.24.3, which does not reliably honour `[[allowlists]]` regexes under `extend`). Never allowlist the historical leak from [#38](https://github.com/desimpson/syncer/issues/38)
- Coverage HTML lives under `coverage/` locally and as CI artifact `coverage` — not on Pages or obsidiansyncer.com
- Machine-readable baseline for vs-main checks: orphan `badges` branch (`coverage-summary.json` + SVG badges). A `main`-only `publish-badges` job with `contents: write` pushes via `GITHUB_TOKEN` (does not re-trigger Test & Lint); workflow also ignores `badges` branch pushes
- **Stale badge** — SVGs update only on successful `main` coverage runs; PR README badges show last-`main` values
- **Floor fail** — Vitest `ERROR: Coverage … below threshold` from `vitest.config.ts`; distinct from vs-main (`Coverage vs main:` prefix in CI log)
- **Vs-main fetch error** — fail-closed by design (not treated as skip); re-run the job
- **Missing artifact** — coverage step failed or `json-summary` / `lcov` reporters removed from config

## Agent pitfalls

- Do not assume every integration is exported from barrel `index.ts` files
- Product rules live in job comments and `sync-semantics.md` — README is user-facing, not the reconcile oracle
- OAuth uses a localhost redirect + Node modules, so `manifest.json` must stay aligned with desktop-only behavior (`"isDesktopOnly": true`)
