# Syncer

Obsidian plugin to sync external sources like Google Tasks, Microsoft Outlook, and Firefox Bookmarks into your vault.

This plugin fetches data from external sources and syncs them to a target Markdown document under a configurable heading. Supported sources are Google Tasks, Microsoft Outlook (flagged mail), and Firefox Bookmarks (desktop). Inspired by [_Getting Things Done_ (GTD)](https://en.wikipedia.org/wiki/Getting_Things_Done), but equally suited to any workflow based on to-do lists or Kanban boards. Designed to integrate well with the [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban) and the [Obsidian Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks).

[![Screenshot of Syncer plugin](screenshots/gtd-kanban-example.png)](screenshots/gtd-kanban-example.png)

## Features

- Scheduled background sync on a configurable interval (minutes)
- Manual sync command from the Command Palette
- Configurable target Markdown file to write to
- Configurable target heading under which items will be inserted
- Optional sync of completion status from Obsidian back to connected sources (off by default)
- Google Tasks integration:
  - OAuth 2.0 (Authorization Code with PKCE)
  - Select which task lists to sync
  - Only incomplete Google Tasks are synced into Obsidian; when you complete a task in Google it drops out of the incoming feed and the corresponding line is removed from the items under the target heading in the Obsidian note on the next sync
  - Optional deletion sync: deleting a synced Google task in Obsidian can also delete it in Google Tasks (with optional confirmation)
- Microsoft Outlook integration:
  - OAuth 2.0 (Authorization Code with PKCE) via Microsoft identity platform
  - Syncs messages with an Outlook follow-up flag set to flagged
  - Personal (Outlook.com / Hotmail / Live) or work/school accounts (optional Entra tenant ID)
  - When completion status sync is enabled, checking/unchecking items in Obsidian updates the Outlook flag on the next sync
- Firefox Bookmarks integration (desktop only):
  - Sync bookmarks from a local Firefox profile into your vault
  - Auto-detect default profile or set a manual profile path
  - Search and select bookmark folders (subfolders included recursively)
  - One-way sync: Firefox → Obsidian only; checking items in Obsidian does not change Firefox
  - Works while Firefox is open when `sqlite3` or Python is available to merge the places WAL; otherwise close Firefox briefly and sync again

## Requirements

- Node.js >= 22.15 (for builds and tests)
- Obsidian Desktop
- (Optional) [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban) for task board views
- (Optional) [Obsidian Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) for enhanced task management

## Installation

Manual install into a vault:

1. Build the plugin (see [Development](#development) below)
1. Copy these files to your vault: `Vault/.obsidian/plugins/syncer/`
   - `manifest.json`
   - `main.js`
   - `sql-wasm.wasm`
   - `styles.css`
1. Enable “Syncer” in Obsidian → Settings → Community plugins

## Configuration

Open Obsidian settings and navigate to **Community plugins** → **Syncer**.

GTD tip: The plugin ships with sensible defaults for a GTD-style setup—`GTD.md` as the target file and `## Inbox` as the heading. You can keep these for a classic capture inbox, or change them to suit your workflow.

### General

- **Sync interval (minutes)**: How often background sync runs
- **Sync markdown file path**: Target note for synced items (sync reads the saved file on disk—save changes before running Manual sync)
- **Sync heading**: H2 heading under which new items are inserted (input is normalised to `## …`)
- **Sync completion status**: When enabled, completing or uncompleting synced items in Obsidian updates Google Tasks and Microsoft Outlook (email flags) on the next sync

### Google Tasks

- Connect your Google account using the **Connect** button in the plugin's settings tab
- Select task lists to sync via the multi-select input
- Optionally enable **Sync task deletions** (and confirmation) so deleting a Google Tasks item in Obsidian also deletes it in Google Tasks

### Microsoft Outlook

- Choose **Outlook account type** (personal or work/school); for work/school you may optionally set a Directory (tenant) ID
- Connect your Microsoft account using the **Connect** button (requires the plugin to be built with a Microsoft application client ID)
- Flagged messages are synced into the target note under the sync heading

### Firefox Bookmarks (desktop only)

- Enable **Firefox Bookmarks** in the plugin settings
- Optionally set a **Firefox profile path**; leave empty to auto-detect the default profile from `profiles.ini`
- Click **Refresh folders**, then search by folder name and select parents to include (subfolders are synced recursively — nested matches under a hit are hidden in search)
- Typical profile locations:
  - Linux: `~/.mozilla/firefox/<profile>/`
  - macOS: `~/Library/Application Support/Firefox/Profiles/<profile>/`
  - Windows: `%APPDATA%\Mozilla\Firefox\Profiles\<profile>\`
- If newest bookmarks are missing while Firefox is open, close Firefox briefly and sync again (or install the `sqlite3` CLI so the plugin can merge the live database)

## Commands

- `Manual sync`: Triggers a once-off sync and restarts the scheduler

## Development

Contributor/agent notes for architecture and sync rules live in [docs/kb/](docs/kb/).

Install dependencies, then build with esbuild.

```sh
npm clean-install
```

```sh
npm run build:dev
```

Development builds require `GOOGLE_TASKS_CLIENT_ID_DEV` (see `.env.example`). Optionally set `OUTLOOK_CLIENT_ID_DEV` to enable Outlook Connect in local builds.

Sync to your vault with:

```sh
npm run sync
```

You will need to create a dev Obsidian vault and set the `OBSIDIAN_VAULT_PLUGIN_DIR_DEV` variable in a [`.envrc`](https://direnv.net/) file to use the `sync` script. See [`.envrc.example`](.envrc.example) for an example.

It is also recommended to install the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) for automatic reloads.

## Attribution

This plugin includes code adapted from the following projects:

- **Periodic Notes** ([liamcain/obsidian-periodic-notes](https://github.com/liamcain/obsidian-periodic-notes)) - The `Suggest` and `FileSuggest` components used in the settings tab are based on code from this plugin.

## Releasing

1. Update version: `npm run version` (or `npm version patch|minor|major`)
2. Build production: `GOOGLE_TASKS_CLIENT_ID_PROD=your-id OUTLOOK_CLIENT_ID_PROD=your-id npm run build:prod` (both client IDs required for production builds)
3. Verify: `npm run release:check`
4. Create release:
   - **Automated**: `git tag 1.0.0 && git push origin 1.0.0` (triggers release workflow; tags must match `[0-9]*`, e.g. `0.1.0` or `1.0.0`, not `v1.0.0`)
   - **Manual**: Create GitHub release with `main.js`, `manifest.json`, `styles.css`, `sql-wasm.wasm`
5. Submit to [Obsidian Community Plugins](https://github.com/obsidianmd/obsidian-releases)
