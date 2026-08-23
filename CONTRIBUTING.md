# Contributing to Syncer

Thanks for contributing to Syncer.

## Before opening a PR

For behaviour changes, open or comment on an issue first so the approach can be agreed on.

Keep each pull request focused on one bug, feature, or refactor.

## Tests and documentation

Tests and user-facing or knowledge-base documentation should land in the same change when applicable. See the definition of done in [docs/kb/checklists.md](docs/kb/checklists.md).

See [docs/testing.md](docs/testing.md) for testing guidance.

## Pull requests

Write the PR description from the user's point of view.

Link the related issue with `Closes #<id>` when the PR completes it, or `Refs #<id>` when it is related but does not close it.

For bug fixes, commit an `it.fails` test that demonstrates the current incorrect behaviour, then commit the fix and change `it.fails` to `it`.

## Dependency upgrades

For dependency upgrades that ship in `main.js`, smoke-test the affected functionality, including dependencies such as `zod` and `sql.js`.

Lint- or test-only dependency upgrades can merge when CI is green.

## Useful documentation

- [Knowledge base](docs/kb/README.md)
- [Testing](docs/testing.md)
- [Definition of done and checklists](docs/kb/checklists.md)
- [Development](README.md#development)
- [Releasing](README.md#releasing)

These contributing conventions are inspired in part by the [Obsidian Tasks contributing guide](https://publish.obsidian.md/tasks-contributing/Welcome), scaled down for Syncer's needs.
