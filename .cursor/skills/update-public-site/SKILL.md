---
name: update-public-site
description: Keep the Syncer homepage, Privacy, Terms, README marketing copy, manifest description, and screenshots aligned with shipped integrations. Use when adding, removing, or renaming a sync source; changing OAuth, privacy, or write-back behaviour; editing site/; or replacing plugin screenshots.
---

# Update public site

Run in the **same task** as the product change. GitHub Pages deploys [`site/`](site/) from `main` when `site/**` changes.

## When

| Change | Update |
| --- | --- |
| New / renamed / removed source | Source lists everywhere (below) |
| New OAuth provider, scopes, PAT, or filesystem access | [`site/privacy.html`](site/privacy.html), [`site/terms.html`](site/terms.html), README Privacy section, [`SECURITY.md`](SECURITY.md) |
| Google Tasks / Gmail data use | Homepage Google section **and** Privacy — do not paraphrase away required wording |
| Settings UI or Kanban result looks different | Screenshots (below) |
| Tagline / what the plugin is | Homepage, README intro, `manifest.json` / `package.json` `description` |

Skip for test-only, formatting, or internal-only refactors.

## Source lists (keep in lockstep)

Same set of integrations, same names, in all of:

- [`site/index.html`](site/index.html) — meta description, JSON-LD, hero lede, **What Syncer syncs** cards
- [`site/privacy.html`](site/privacy.html) / [`site/terms.html`](site/terms.html) — who is contacted
- [`README.md`](README.md) — intro, Features, Configuration, Privacy hosts
- [`manifest.json`](manifest.json) and [`package.json`](package.json) `description` (Community listing uses the manifest)

One-line cards on the homepage: what is synced, not how OAuth works.

## Google branding copy

Google’s verification crawler matches exact homepage wording. Do **not** “improve” or shorten:

- The purpose sentences that contain **“The purpose of Syncer is”**
- The **Application name: Syncer** line and `<h1>Syncer</h1>`
- The claim that Google APIs are used **only** for Google Tasks and Gmail Starred
- The Limited Use sentence in Privacy

Add a new Google integration only by extending the existing Google data-use list with the same factual style. If unsure, leave that prose and ask.

## Brand lockup

- Mark only: [`site/favicon.svg`](site/favicon.svg) (tab icon) and [`site/logo.png`](site/logo.png) (512², also Todoist `logo_uri` at `https://obsidiansyncer.com/logo.png`). Same mark at 300²: [`docs/branding/logo-300.png`](docs/branding/logo-300.png). Upload the 512 raster to Google consent and Entra branding. Todoist DCR clients set `logo_uri` on `POST /oauth/register` (re-register to change it) — do not invent a second mark.
- Word + mark: [`site/lockup.svg`](site/lockup.svg) in the site header (transparent; do not put `logo.png` in the hero). [`site/lockup.png`](site/lockup.png) at the top of the README (dark plate so it holds on GitHub light and dark).
- Homepage must still show a visible `<h1>Syncer</h1>` and **Application name: Syncer** for Google.

## Screenshots

Files: [`screenshots/`](screenshots/) (README + Community) and [`site/screenshot.png`](site/screenshot.png) (homepage hero).

- Community desktop: JPEG/PNG/WebP, **1200×800** (3:2), max 5 MB, max 5 shots. Plugin is desktop-only — skip mobile.
- Do not publish vault name, personal emails, PATs, or live account URLs. Stage a sanitised `GTD.md`; **disable Syncer** while editing it so reconcile does not restore real items.
- README only: Kanban close-up, then Markdown source. Keep the other files in `screenshots/` for Community; do not dump the full set in the README.
- After replacing shots, point README at those two files and match `site/index.html` `<img>` width/height to the hero PNG (same crop as the close-up).
- Community uploads are manual at community.obsidian.md (not git).

## Done when

- Source names match `SyncSource` in [`src/sync/types.ts`](src/sync/types.ts)
- Privacy still says there is no Syncer backend
- No drive-by rewrite of unrelated homepage or legal prose
