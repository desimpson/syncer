# Delivery checklists

Small, repeatable checklists for this Obsidian plugin. Keep these lightweight.

## Definition of done (minimum)

- Behaviour change implemented and covered by the right test level (unit/integration/manual)
- For reconcile/parser/writer logic, consider a targeted invariant/property test; keep scope lean for repo size
- PRs must keep `npm run test:coverage` green (local floor + CI vs-main baseline when present)
- Relevant KB page updated in the same task (`architecture`, `sync-semantics`, `conventions`, or `gotchas`)
- PR description links issue with `Closes #<id>` (or `Refs #<id>` when not closing)
- Before merging a PR that closes an issue, post evidence comment on the issue: PR link, automated results, and manual notes

## Temporary diagnostics policy

- Allow temporary logs only for active debugging of a reproducible bug
- Scope logs to the smallest area possible and avoid broad always-on noise
- Remove or disable diagnostics before merge unless explicitly agreed otherwise
- If retained temporarily, create a follow-up issue with clear removal criteria

## New integration template (minimum)

For each new source integration:

- `services/`: fetch/read source data via Obsidian `requestUrl` (no vault/UI APIs)
- `adaptors/`: map source DTOs to `SyncItem`
- `jobs/`: settings/auth orchestration + call shared atomic reconcile
- `plugin/`: settings UI wiring and notices
- tests: unit coverage for mapping/parsing + integration coverage for job sync path
- docs: update `sync-semantics.md` and any changed `gotchas.md`/`architecture.md`
- public copy: homepage source cards, Privacy/Terms, README, `manifest.json` description — see [`update-public-site`](../../.cursor/skills/update-public-site/SKILL.md)

## Release smoke checks

Run before tagging/release:

- Build passes and produced plugin files load in Obsidian desktop
- Prefer `npm version patch|minor|major` so the version commit and **annotated** tag are created together
- Git tag and `manifest.json` version match exactly (`x.y.z`, no `v` prefix)
- Tag is annotated (`git cat-file -t refs/tags/x.y.z` → `tag`); lightweight tags are not pushed by `git push --follow-tags`
- `npm run release:check` passes (also rejects a lightweight tag when the version tag exists)
- GitHub release includes `main.js`, `manifest.json`, and `styles.css`
- Manual sync works for each enabled integration in a real vault note
- Completion/deletion toggles behave as documented for enabled integrations
- No temporary debug diagnostics left enabled by default
- For first public release, submit through `community.obsidian.md` and resolve all automated review findings before publish
