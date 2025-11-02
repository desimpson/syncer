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
