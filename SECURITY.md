# Security

Syncer is a local Obsidian plugin. It does not run a Syncer backend, proxy, or hosted API. Canonical user-facing policy: [Privacy Policy](https://obsidiansyncer.com/privacy.html) and [Terms of Service](https://obsidiansyncer.com/terms.html).

## Capabilities

| Capability | When | Scope |
| --- | --- | --- |
| Vault read/write | Sync enabled | User-chosen sync markdown note via Obsidian `vault` APIs |
| Network (OAuth / APIs) | Connected integrations | Google, Microsoft, Azure DevOps endpoints only |
| Localhost OAuth redirect | Connect flows | Ephemeral desktop HTTP server on loopback |
| Outside-vault filesystem read | Firefox Bookmarks enabled (desktop) | Firefox profile `profiles.ini`, `places.sqlite`, `places.sqlite-wal` under auto-detected roots (`~/.mozilla/firefox`, `~/.config/mozilla/firefox`, Snap, Flatpak, plus macOS/Windows profile folders) or a user-set path; temp hot-copies under a process-owned `mkdtemp` directory |
| Local subprocess | Firefox WAL merge (optional) | Trusted `sqlite3` or `python3` binaries only, fixed argv templates |

## Firefox Bookmarks filesystem access

When Firefox Bookmarks sync runs, Syncer reads files outside your vault using Node.js `fs` in the Obsidian desktop (Electron) renderer. Access is scoped by:

- **Basename allowlist** — only `profiles.ini`, `places.sqlite`, `places.sqlite-wal`, and temp copy names (`merged.sqlite`, etc.)
- **Canonical path checks** — `realpath` + root containment for Firefox profile roots (Linux: `~/.mozilla/firefox`, `~/.config/mozilla/firefox`, Snap, Flatpak; plus macOS/Windows profile folders), the resolved profile directory, and the single `mkdtemp` directory created for each read
- **Temp-only writes** — hot-copies and merge outputs; Syncer does not modify the live Firefox profile database

Plugin Observer may still report **Direct Filesystem Access** while `node:fs` is present in `main.js`. That warning reflects capability, not an unscoped read of the whole disk.

## Credentials

OAuth tokens and Azure DevOps PATs are stored in Obsidian plugin settings (`data.json`). They are sent only to the matching provider endpoints.

## Telemetry

Syncer does not include client-side telemetry, analytics SDKs, or ads.

## Reporting

Report security concerns via [GitHub Issues](https://github.com/desimpson/syncer/issues).
