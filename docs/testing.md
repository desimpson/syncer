# Test Structure

This project separates tests into two categories following conventional naming:

## Unit Tests (`tests/unit/`)

Pure function tests with no external dependencies or mocks:

- **Fast execution** (< 100ms typically)
- **No mocking** of external systems
- **Pure functions** with deterministic inputs/outputs
- **No I/O operations** (file system, network, timers)

### Examples:

- `utils/string-formatters.test.ts` - String formatting functions
- `utils/error-formatters.test.ts` - Error formatting functions
- `sync/actions.test.ts` - Sync action generation logic
- `plugin/schemas.test.ts` - Zod schema validation
- `services/schemas.test.ts` - Service schema validation

## Integration Tests (`tests/integration/`)

Tests that mock external dependencies and test component interactions:

- **Slower execution** (may include network timeouts)
- **Extensive mocking** (HTTP, file system, DOM, timers)
- **Component integration** testing
- **External dependency simulation**

### Examples:

- `auth/google.test.ts` - HTTP server and OAuth flow mocking
- `jobs/google-tasks.test.ts` - Obsidian vault and service mocking
- `services/google-tasks.test.ts` - HTTP API call mocking
- `sync/writer.test.ts` - File system operation mocking
- `sync/reader.test.ts` - File reading operation mocking
- `utils/popper.test.ts` - DOM manipulation with jsdom

## Commands

```bash
# Run all tests
npm run test

# Run only unit tests (fast)
npm run test:unit

# Run only integration tests
npm run test:integration

# Run full suite with coverage report and quality gates
npm run test:coverage

# Watch mode
npm run test:unit:watch
npm run test:integration:watch
```

## Directory Structure

```
tests/
├── unit/                 # Pure function tests
│   ├── utils/
│   ├── sync/
│   ├── plugin/
│   └── services/
├── integration/          # Mock-based tests
│   ├── auth/
│   ├── jobs/
│   ├── services/
│   ├── sync/
│   ├── plugin/
│   ├── utils/
│   └── mocks/           # Shared test mocks
│       └── obsidian.ts
├── vitest.unit.config.ts
└── vitest.integration.config.ts
```

## Benefits

- **Fast feedback loop**: Unit tests run in ~300ms, perfect for TDD
- **Isolation**: Integration test failures don't affect unit test confidence
- **CI optimization**: Can run unit tests first, fail fast on logic errors
- **Clear separation**: Easy to identify test types and their purposes
- **Parallel execution**: Different test suites can run independently

## Coverage

`npm run test:coverage` runs the combined unit + integration suite with Istanbul v8 coverage scoped to `src/**/*.ts` (excludes `*.d.ts` and `types.ts`). Reporters: text table, `coverage/coverage-summary.json`, `coverage/lcov.info`, and HTML under `coverage/`.

**Local floor** — `vitest.config.ts` enforces minimum line and branch percentages (`thresholds.lines` / `thresholds.branches`). Floors match current `src/` coverage at implementation time; bump them in a dedicated PR when coverage clearly improves.

**CI vs-main** — PRs fetch the baseline from `https://raw.githubusercontent.com/desimpson/syncer/badges/coverage-summary.json` (last successful `main` run). The job fails if line or branch % drops below baseline. HTTP 404 means no baseline yet (first `main` publish) and skips with a warning; any other fetch error fails closed — re-run the job.

**Artifacts** — CI uploads `coverage/coverage-summary.json` and `coverage/lcov.info` as artifact `coverage` (even when the gate fails). Coverage HTML is not published on GitHub Pages.

**Badges** — On `main`, the `publish-badges` job downloads the coverage artifact, generates `coverage-lines.svg` and `coverage-branches.svg`, and updates the `badges` branch with those SVGs plus `coverage-summary.json`. README badges read from raw.githubusercontent.com; PRs show last-`main` values until merge.

### Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `ERROR: Coverage … below threshold` | Local floor fail — compare text table to `vitest.config.ts` thresholds |
| `Coverage vs main: … regressed` | PR coverage below `badges/coverage-summary.json` — add tests |
| `Coverage vs main: baseline not found` | First `main` run has not published yet |
| `Coverage vs main: failed to fetch` | Transient GitHub/raw CDN error — re-run CI |
| Badge shows old % | SVGs update only on `main`; check latest `badges` commit |
| Raw SVG 404 | No successful `main` coverage job yet, or `badges` branch missing |

## Scoped property-based testing and contracts

Use these techniques selectively to match Syncer's size and risk profile:

- Prefer property-based tests for sync-core invariants (`src/sync/actions.ts`, `src/sync/reader.ts`, `src/sync/writer.ts`) where many input combinations can hide edge cases
- Keep property-based coverage small and purposeful (idempotence, create/update/delete partitioning, completed-delete preservation, parse/write stability)
- Do not replace broad example-based tests in `jobs/`, `services/`, or `auth/` with heavy generator suites; side-effect flows remain better served by focused integration tests
- Treat Zod schemas as the primary runtime contract mechanism at boundaries (settings, provider payloads, markdown metadata)
- Add internal contract assertions only for critical invariants in complex paths; avoid pervasive DbC-style guards on every helper
