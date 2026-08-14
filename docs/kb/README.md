# Syncer knowledge base

Short, living notes for agents and contributors. Prefer links into `src/` over copying README marketing text.

## Pages

| Page                                   | When to read / update                             |
| -------------------------------------- | ------------------------------------------------- |
| [architecture.md](architecture.md)     | Module layers, Mermaid diagrams, pipeline wiring  |
| [sync-semantics.md](sync-semantics.md) | Product rules for reconcile, completion, deletion |
| [conventions.md](conventions.md)       | Naming, Zod, errors, spelling                     |
| [gotchas.md](gotchas.md)               | Footguns, env gaps, known traps                   |
| [checklists.md](checklists.md)         | DoD, issue/PR evidence, debug, release smoke      |

Also see [docs/design.md](../design.md) for product intent and roadmap, and [docs/testing.md](../testing.md) for unit vs integration layout (do not duplicate here).

## When to update

This index is the policy source of truth. [`.cursor/rules/project.mdc`](../../.cursor/rules/project.mdc) and the [`update-knowledge-base`](../../.cursor/skills/update-knowledge-base/SKILL.md) skill link back here rather than duplicating the table.

Treat KB updates as part of the same task when behavior changes:

| Change type                        | Update                           |
| ---------------------------------- | -------------------------------- |
| New/changed sync product rule      | `sync-semantics.md`              |
| New module / layer / wiring        | `architecture.md`                |
| New convention or pattern decision | `conventions.md`                 |
| Footgun / env / known trap         | `gotchas.md`                     |
| Delivery / issue / release process | `checklists.md`                  |
| Test layout change                 | [docs/testing.md](../testing.md) |
| Public homepage / legal / screenshots | not KB — [`update-public-site`](../../.cursor/skills/update-public-site/SKILL.md) |

**Sizing:** keep each page under ~80 lines. Never invent features — cite paths. Use the [`update-knowledge-base`](../../.cursor/skills/update-knowledge-base/SKILL.md) project skill after meaningful code changes.
