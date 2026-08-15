# Syncer design

Living design document for the Syncer Obsidian plugin. The implementation in `src/` and the short agent notes in [`docs/kb/`](kb/README.md) are authoritative for day-to-day behaviour; this page captures product intent, architecture, trade-offs, and roadmap.

**Related docs**

| Doc                                                         | Role                                  |
| ----------------------------------------------------------- | ------------------------------------- |
| [`docs/kb/architecture.md`](kb/architecture.md)             | Layer map and pipeline wiring         |
| [`docs/kb/sync-semantics.md`](kb/sync-semantics.md)         | Reconcile / completion / delete rules |
| [`docs/kb/conventions.md`](kb/conventions.md)               | Naming, Zod, layering norms           |
| [`docs/kb/gotchas.md`](kb/gotchas.md)                       | Footguns and env traps                |
| [`docs/testing.md`](testing.md)                             | Unit vs integration layout            |
| [GitHub issues](https://github.com/desimpson/syncer/issues) | Product and engineering backlog       |

---

## 1. Purpose

Syncer pulls references/links to actionable items from external sources into a single Obsidian Markdown note under a configurable H2 heading. The target surface is deliberately **inbox-shaped**: a capture column that works with [Obsidian Kanban](https://github.com/mgmeyers/obsidian-kanban) and [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks), inspired by Getting Things Done (GTD).

The plugin is **local-only**. OAuth runs on the user’s machine (ephemeral localhost redirect). There is no Syncer backend, webhook receiver, or hosted MCP/API proxy.

### Sources today

| Source            | Direction                                            | What syncs                                     |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Google Tasks      | Mostly pull; optional completion + delete write-back | Incomplete tasks from selected lists           |
| Gmail Starred     | Mostly pull; optional star write-back                | Starred messages (newest N)                    |
| Microsoft To Do   | Mostly pull; optional completion write-back          | Incomplete tasks from selected To Do lists     |
| Todoist           | Mostly pull; optional completion write-back          | Active tasks from selected projects            |
| Microsoft Outlook | Mostly pull; optional flag write-back                | Messages with Outlook follow-up flag `flagged` |
| Azure DevOps      | One-way pull                                         | Work items assigned to the connected user      |
| Firefox Bookmarks | One-way pull (desktop)                               | Bookmarks under selected folders (recursive)   |

---

## 2. Product model (current)

### 2.1 Vault write model

All integrations write **checkbox task lines** into one user-chosen note (`syncDocument`), under one H2 (`syncHeading`).

Example line (written by [`src/sync/writer.ts`](../src/sync/writer.ts)):

```text
- [ ] [title](link) <!-- {"id":"…","source":"google-tasks","title":"…","link":"…","heading":"## Inbox"} -->
```

- Checkbox is the in-file completion source of truth; metadata JSON omits `completed` (derived on read).
- Stable identity for reconcile is `id` within a `source` (writer map key `id:source`).
- Optional in-file anchor `<!-- syncer:anchor -->`: creates insert after the first heading following the marker.
- Placement respects a Kanban `%% kanban:settings` block when present.

This is a deliberate departure from the early design’s **one Markdown file per item** under paths like `Syncer/{source}/{accountId}/{date}-{titleSlug}-{id}.md`. The current model optimises for a shared GTD/Kanban inbox rather than an archival note tree.

### 2.2 Settings (plugin `data.json`)

Settings are Obsidian plugin data (`loadData` / `saveData`), validated by Zod in [`src/plugin/schemas.ts`](../src/plugin/schemas.ts). Shape is **integration-keyed**, not a generic `sources.gmail[]` array:

| Area              | Notable fields                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Global            | `syncIntervalMinutes`, `syncDocument`, `syncHeading`, `syncCompletionStatus`, `enableDeleteSync`, `confirmDeleteSync`, `manuallyDeletedTaskIds` |
| Google Tasks      | credentials, `availableLists`, `selectedListIds`, `userInfo.email`                                                                              |
| Microsoft Outlook | credentials (incl. `tenantSegment`), account kind / tenant ID, `userInfo`                                                                       |
| Microsoft To Do   | credentials (incl. `tenantSegment`), `availableLists`, `selectedListIds`, `userInfo`; shares account-kind fields with Outlook for next Connect |
| Todoist           | credentials, `availableProjects`, `selectedProjectIds`, `userInfo`                                                                              |
| Firefox Bookmarks | profile paths, `availableFolders`, `selectedFolderGuids`                                                                                        |

OAuth tokens live **in plugin settings**, not a separate OS keychain. Build-time client IDs (`GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `TODOIST_CLIENT_ID`) are injected by esbuild and validated via `pluginSchema`.

There is **one connected account per OAuth source** today. Multi-account support is backlog ([#40](https://github.com/desimpson/syncer/issues/40)).

### 2.3 What Syncer is not (yet)

Relative to the early design doc, these are **not** implemented as product features:

- Per-item Markdown files with YAML frontmatter under a `Syncer/` tree
- Separate Kanban writer that only inserts links to those files
- `last-sync-store` incremental fetch with mid-sync cutoff timestamps
- Retention policy that deletes aged vault files
- Atomic sync via `.tmp.md` rename batches
- Periodic full resync to recreate user-deleted per-item files
- Generic IMAP/SMTP, calendars, or a large integration matrix in-tree

Some of those ideas remain useful as **future options** (see §8–9); the live product is the shared inbox note.

---

## 3. Architecture

Layer map, Mermaid diagrams (module map, bootstrap, one job cycle), and pipeline notes live in [`docs/kb/architecture.md`](kb/architecture.md). Prefer that page over duplicating diagrams here.

Hard constraints:

- No provider HTTP in `sync/`
- No Obsidian APIs in `services/` or `adaptors/`
- New integrations must write through `reconcileSyncSourceAtomically` ([`src/sync/writer.ts`](../src/sync/writer.ts))

Bundle entry: `esbuild.config.mjs` → `src/plugin/index.ts` → `main.js` (sql.js WASM is bundled into `main.js`).

### 3.1 Core types

| Type             | Location                | Role                                                                                                                            |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `SyncItem`       | `src/sync/types.ts`     | `{ id, source, title, link, heading, completed }`                                                                               |
| `SyncAction`     | `src/sync/types.ts`     | create / update / delete over a `SyncItem`                                                                                      |
| `SyncSource`     | `src/sync/types.ts`     | `"google-tasks" \| "gmail-starred" \| "microsoft-to-do" \| "microsoft-outlook" \| "azure-devops" \| "firefox-bookmarks" \| "todoist"` |
| `SyncJob`        | `src/jobs/types.ts`     | `{ name, task }`                                                                                                                |
| `SyncAdaptor<T>` | `src/adaptors/types.ts` | `(heading) => (dto) => SyncItem`                                                                                                |

Settings use `syncHeading`; domain `SyncItem` still uses `heading` ([#48](https://github.com/desimpson/syncer/issues/48)).

### 3.2 Project layout (actual)

```text
src/
├── plugin/       # entrypoint, settings tab, save-sync-document, schemas, modals, suggesters
├── sync/         # scheduler, prepare-sync-document, actions, reader, writer, sync-guard
├── jobs/         # google-tasks, gmail-starred, microsoft-todo, microsoft-outlook, azure-devops, firefox-bookmarks, todoist
├── services/     # API clients + Firefox sqlite/profile helpers
├── adaptors/     # DTO → SyncItem
├── auth/         # google, microsoft, todoist, azure-devops
├── utils/
└── types/        # ambient (e.g. sql.js)
tests/
├── unit/         # mirrors src areas; pure logic
└── integration/  # vault/HTTP/DOM/timer mocks
```

Compared with the early `core/` + `integrations/{api-clients,source-adapters}/` sketch: responsibilities are the same idea, but names match Obsidian-plugin practice (`plugin/`, `jobs/`, `services/`, `adaptors/`, `sync/`).

---

## 4. Sync semantics

Full rules: [`docs/kb/sync-semantics.md`](kb/sync-semantics.md). Summary:

### Reconcile

[`generateSyncActions`](../src/sync/actions.ts):

- **Create** — in incoming feed, not in file
- **Update** — metadata or completion differs
- **Delete** — in file for that source, not in incoming feed

**Completed-preserve:** completed Obsidian lines (`[x]`) are not deleted when the remote item leaves the feed. This lets users move finished work into other Kanban columns without Syncer wiping them.

**Atomic write:** `reconcileSyncSourceAtomically` parses, plans, and applies inside one `vault.process` so jobs do not plan from a stale `vault.read` then write later (that race dropped Firefox creates).

### Google Tasks specifics

- Incoming = **incomplete** tasks from selected lists only
- Completing in Google drops the task from the feed → line removed unless already completed in Obsidian
- `syncCompletionStatus`: push checkbox changes to Google (including uncomplete restoring a Google-completed task)
- `enableDeleteSync` (default off): vault line removal can delete the Google task; `confirmDeleteSync` (default on when enabled) prompts before remote delete
- `manuallyDeletedTaskIds`: suppress re-create when the user declined remote delete
- SyncGuard skips delete-detection while sync is rewriting the note

### Outlook / To Do / Firefox

- Outlook: flagged mail only; completion sync toggles the Outlook flag; no vault→remote delete path
- To Do: mirrors Google Tasks incomplete-feed + completion pushback; remote complete removes unchecked lines (no auto `[x]`); separate Tasks OAuth token from Outlook
- Firefox: local profile SQLite via sql.js (+ WAL merge helpers); checkbox is local-only

---

## 5. Authentication

| Provider  | Flow                                     | Notes                                                                                       |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Google    | Auth Code via ephemeral localhost server | **No PKCE** in `src/auth/google.ts`; UWP-style public client ID (no secret).                |
| Microsoft | Auth Code + **PKCE (S256)** + `state`    | Token POSTs use Obsidian `requestUrl`; tenant segment from personal vs work/school settings |

Refresh tokens are stored with credentials in plugin settings. Revoked refresh → clear credentials and prompt reconnect. Microsoft revoked-access UX hardening: [#65](https://github.com/desimpson/syncer/issues/65).

---

## 6. Scheduling, offline, and failure modes

| Concern                 | Current behaviour                                                                                             | Early-design idea                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Schedule                | Interval minutes + immediate run on start/restart                                                             | Same spirit (cron-like)                                                                                                          |
| Manual sync             | Command palette → `scheduler.restart`                                                                         | Same                                                                                                                             |
| Job isolation           | One job failure is logged; others continue                                                                    | —                                                                                                                                |
| Offline                 | Failures surface as job errors / notices; no exponential backoff scheduler yet                                | Exponential backoff ([#33](https://github.com/desimpson/syncer/issues/33), [#34](https://github.com/desimpson/syncer/issues/34)) |
| Mid-sync remote updates | Full refetch of current feed each sync (no `lastSuccessfulSync` watermark)                                    | Cutoff timestamp + incremental fetch                                                                                             |
| Partial vault writes    | Single-file `vault.process` per job; not multi-file `.tmp.md` staging                                         | Temp files for multi-file atomicity                                                                                              |
| User deletes lines      | Google: optional remote delete + tombstone IDs; others: next sync recreates unless completed-preserve applies | Periodic full resync for missing per-item files                                                                                  |

Each sync tick saves the sync note when it is open with unsaved edits (including Kanban), then reads the settled on-disk file.

---

## 7. Build, environments, and release

| Mode    | npm script            | Client IDs                                                                           |
| ------- | --------------------- | ------------------------------------------------------------------------------------ |
| `dev`   | `build:dev`           | `GOOGLE_CLIENT_ID_DEV` required; `MICROSOFT_CLIENT_ID_DEV` / `TODOIST_CLIENT_ID_DEV` optional |
| `prod`  | `build:prod`          | committed `oauth-clients.prod.json` (Google, Microsoft, Todoist)                     |
| `watch` | `build:watch` / `dev` | same as `dev`                                                                        |

CI (`.github/workflows/build.yml`):

- All branches: typecheck, lint, format, `check:oauth-clients`, unit + integration tests, coverage with floor + vs-main baseline check ([#84](https://github.com/desimpson/syncer/issues/84))
- Non-`main`: build with GitHub Environment **`dev`** (`*_DEV` secrets)
- `main`: production build from committed `oauth-clients.prod.json` (GitHub Environment **`prod`**, no client-ID secrets); coverage badges published to `badges` branch

Release (`.github/workflows/release.yml`): **annotated** version tags matching `[0-9]*` (lightweight tags are skipped by `git push --follow-tags`), GitHub Environment **`prod`**, committed `oauth-clients.prod.json` (no `*_PROD` secret injects), attach `main.js` / `manifest.json` / `styles.css`, then submit first release via `community.obsidian.md`.

Local vault install helper: `npm run sync` + `OBSIDIAN_VAULT_PLUGIN_DIR_DEV` (see `.envrc.example`). Contributor bootstrap: [#70](https://github.com/desimpson/syncer/issues/70).

---

## 8. Roadmap (from open issues)

Grouped; numbers are GitHub issues. This is not a commitment calendar.

### Sync correctness and UX

- List-deselect warnings / delete scope ([#32](https://github.com/desimpson/syncer/issues/32))
- Escape `--` in URLs inside HTML metadata comments ([#31](https://github.com/desimpson/syncer/issues/31))
- Offline / missing-document feedback ([#33](https://github.com/desimpson/syncer/issues/33), [#34](https://github.com/desimpson/syncer/issues/34))
- Non-Kanban target file behaviour ([#37](https://github.com/desimpson/syncer/issues/37))
- Completion scenario coverage ([#36](https://github.com/desimpson/syncer/issues/36))
- Clear-all synced items ([#43](https://github.com/desimpson/syncer/issues/43))
- Optional sync to top of file ([#42](https://github.com/desimpson/syncer/issues/42))

### Platform / multi-account

- Multiple accounts per source ([#40](https://github.com/desimpson/syncer/issues/40))
- Custom error model ([#41](https://github.com/desimpson/syncer/issues/41))
- Microsoft revoked access ([#65](https://github.com/desimpson/syncer/issues/65))
- Auth app registration / tenant cleanup ([#93](https://github.com/desimpson/syncer/issues/93))

### Near-term integrations (examples)

Tracked under the [top-10 rollout](https://github.com/desimpson/syncer/issues/64) and individual issues, including GitHub ([#57](https://github.com/desimpson/syncer/issues/57)), and others (Jira, Linear, Slack, Asana, calendars-adjacent tools, etc.). Gmail Starred, Azure DevOps, Microsoft To Do, and Todoist are shipped in the current product (see §1).

New sources should follow the existing **job → service → adaptor → atomic reconcile** template; prefer inbox lines unless a source’s product case clearly needs a different vault shape.

### Engineering quality

- `.nvmrc` in Actions ([#39](https://github.com/desimpson/syncer/issues/39)), branch protection ([#50](https://github.com/desimpson/syncer/issues/50)), history scrub of old OAuth secret ([#38](https://github.com/desimpson/syncer/issues/38))
- Test depth / PBT / DbC pilots ([#46](https://github.com/desimpson/syncer/issues/46), [#85](https://github.com/desimpson/syncer/issues/85)–[#87](https://github.com/desimpson/syncer/issues/87))
- Tooling experiments: Vitest → Node test runner ([#53](https://github.com/desimpson/syncer/issues/53)), TSDoc lint ([#49](https://github.com/desimpson/syncer/issues/49)), barrel imports ([#47](https://github.com/desimpson/syncer/issues/47)), dev-only file logging ([#52](https://github.com/desimpson/syncer/issues/52))

---

## 9. Open questions

These echo the early design’s open questions, updated for the current product:

1. **How far should two-way sync go?**  
   Completion write-back exists for Google Tasks, Gmail Starred, Microsoft To Do, Outlook, and Todoist; vault→Google delete sync is optional. Creating remote items from Obsidian, or editing titles remotely from the note, is not supported. Real-time bidirectional investigation: [#51](https://github.com/desimpson/syncer/issues/51).

2. **Real-time sync without a backend?**  
   Local-only constraint rules out hosted webhooks. Practical options are shorter polling intervals and richer failure UX ([#34](https://github.com/desimpson/syncer/issues/34)), not a Syncer cloud.

3. **Conflict resolution when users edit synced lines?**  
   Today, remote title/link/completion win on the next reconcile for matching `id:source` (subject to completed-preserve and tombstones). There is no conflict UI. Per-file archival designs would need an explicit overwrite vs preserve policy; the inbox model mostly treats the line as Syncer-owned metadata plus a user-owned checkbox/column.

4. **When (if ever) to introduce per-item Markdown files?**  
   Useful for email bodies, long descriptions, or reference archives (early Gmail/Tasks design). The Kanban inbox should remain the default capture path. A future design could add an optional “materialise note” writer without replacing line-based reconcile.

5. **Incremental fetch / retention**  
   Worth revisiting if feeds become large (Gmail, issue trackers). Prefer a watermark + cutoff (§ early “Missed Updates” solution) before multi-file temp staging unless the vault write model changes.

6. **Multi-account pathing**  
   If [#40](https://github.com/desimpson/syncer/issues/40) lands, settings will need account-scoped credentials and selection; vault identity may stay `id:source` with account encoded in `id` or an added field — path-based account segments only matter if per-item files return.

---

## 10. Design principles (working)

1. **Local-first, vault-owned** — no Syncer server; user data stays in the vault and plugin data folder.
2. **Inbox over archive by default** — one note + heading beats a deep file tree for GTD capture.
3. **Layered integrations** — HTTP in `services/`, mapping in `adaptors/`, reconcile in `sync/`, glue in `jobs/`.
4. **Atomic reconcile per source** — plan and write from the same `vault.process` snapshot.
5. **Preserve user-organised completed work** — do not delete `[x]` lines just because the remote feed moved on.
6. **Fail per job, not per schedule** — one broken integration must not stop the others.
7. **Document product rules next to code** — update `docs/kb/` when sync semantics or architecture change; keep this design doc for intent and roadmap.

---

## 11. Relationship to the early design document

The early design correctly anticipated OAuth-with-refresh, scheduled sync, layered clients/adapters, Kanban-oriented UX, and several failure modes (missed updates, offline, partial writes, deleted files).

What shipped instead of the file-per-item + frontmatter + retention stack:

- A **single shared sync document** with HTML-comment metadata on task lines
- Integration modules named `jobs` / `services` / `adaptors` / `sync`
- Optional **bidirectional completion** (and Google delete sync) earlier than a pure archival writer would need
- Firefox as a **local SQLite** integration, not only cloud OAuth sources

Treat the early doc as historical context. Prefer this file + `docs/kb/` + GitHub issues for current direction.
