---
name: update-knowledge-base
description: Keep docs/kb/ accurate after code or behavior changes. Use when sync semantics, architecture, conventions, or gotchas change; after meaningful refactors; or when the user asks to update the knowledge base or project docs for agents.
---

# Update knowledge base

## When to run

Run as part of the same task that changes behavior — not as an optional follow-up.

Skip for pure formatting, typo-only, or test-only changes that do not alter product rules or structure.

## Steps

1. Identify what changed (diff or task scope) against `docs/kb/`.
2. Read the owning module before writing — never invent features.
3. Update only stale pages; keep each page under ~80 lines.
4. Prefer bullets and links into `src/` over narrative duplication of README.
5. Do not copy test commands into the KB — link [`docs/testing.md`](docs/testing.md).

## Where content goes

| Change                                                         | Page                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| Product sync rules (completion, delete, preserve, item format) | [`docs/kb/sync-semantics.md`](docs/kb/sync-semantics.md) |
| Modules, pipeline wiring, types                                | [`docs/kb/architecture.md`](docs/kb/architecture.md)     |
| Naming, Zod, errors, layering norms                            | [`docs/kb/conventions.md`](docs/kb/conventions.md)       |
| Env, auth traps, known footguns                                | [`docs/kb/gotchas.md`](docs/kb/gotchas.md)               |
| Index / update policy                                          | [`docs/kb/README.md`](docs/kb/README.md)                 |
| Homepage, Privacy/Terms, README source lists, screenshots      | [`update-public-site`](../update-public-site/SKILL.md) — not KB |

Backlog items live in GitHub issues. Mention in `gotchas.md` only when they actively trip agents.

## Done when

- Stale claims removed or corrected
- New rules cite file paths
- No README feature marketing pasted into the KB
