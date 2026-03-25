import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing test isolation between test cases",
      content: "Tests sharing mutable state (global variables, database rows, singletons) cause flaky results depending on execution order. Reset state in beforeEach/afterEach and use fresh fixtures per test.",
      domain: "testing", problemType: "test_isolation", severity: "high", confidence: 0.92,
      tags: ["isolation", "flaky", "beforeEach", "state"],
    },
    {
      title: "Testing implementation details vs behavior",
      content: "Tests that assert internal method calls, private state, or DOM structure break on refactors. Test observable behavior: given input X, assert output Y. Use black-box testing at component/API boundaries.",
      domain: "testing", problemType: "implementation_details", severity: "medium", confidence: 0.88,
      tags: ["behavior", "black-box", "refactor", "implementation"],
    },
    {
      title: "Missing edge case coverage in tests",
      content: "Tests only covering happy paths miss boundary conditions: empty inputs, null values, max integers, special characters, concurrent calls. Add edge cases for each function parameter and error path.",
      domain: "testing", problemType: "edge_cases", severity: "medium", confidence: 0.85,
      tags: ["edge-case", "boundary", "null", "coverage"],
    },
    {
      title: "Flaky tests from timing dependencies",
      content: "Tests relying on setTimeout, real clocks, or network latency are non-deterministic. Use fake timers (vi.useFakeTimers), mock clocks, or waitFor/findBy patterns instead of arbitrary sleep durations.",
      domain: "testing", problemType: "flaky_timing", severity: "high", confidence: 0.90,
      tags: ["flaky", "timing", "fake-timers", "waitFor"],
    },
    {
      title: "Over-mocking hiding real bugs",
      content: "Mocking every dependency means you only test the mock wiring, not actual behavior. Prefer integration tests with real dependencies for critical paths; mock only external services and slow I/O.",
      domain: "testing", problemType: "over_mocking", severity: "medium", confidence: 0.85,
      tags: ["mock", "integration", "real", "dependency"],
    },
    {
      title: "Missing assertion in async test",
      content: "Async tests without await on assertions or expect.assertions(n) pass even when the assertion never executes. Always await async matchers and add expect.assertions() for callback-based tests.",
      domain: "testing", problemType: "missing_assertion", severity: "high", confidence: 0.92,
      tags: ["async", "assertion", "await", "callback"],
    },
    {
      title: "Snapshot tests with unstable output",
      content: "Snapshots containing timestamps, random IDs, or environment-specific paths fail on every run. Normalize dynamic values with serializers or replace them with fixed values before snapshot comparison.",
      domain: "testing", problemType: "unstable_snapshot", severity: "medium", confidence: 0.85,
      tags: ["snapshot", "unstable", "timestamp", "serializer"],
    },
    {
      title: "Test file organization mismatch",
      content: "Test files that don't mirror source file structure are hard to find and maintain. Co-locate tests with source (file.test.ts next to file.ts) or mirror the src/ structure in tests/ consistently.",
      domain: "testing", problemType: "test_organization", severity: "low", confidence: 0.82,
      tags: ["organization", "co-locate", "structure", "naming"],
    },
    {
      title: "Missing test for error/exception paths",
      content: "Only testing success cases means error handling is untested. Explicitly test that functions throw expected errors: `expect(() => fn()).toThrow('msg')`, and test API error response codes and bodies.",
      domain: "testing", problemType: "error_path", severity: "medium", confidence: 0.88,
      tags: ["error", "throw", "exception", "coverage"],
    },
    {
      title: "Hardcoded test data creating brittle tests",
      content: "Tests with magic numbers and hardcoded strings break when requirements change. Use factory functions, builders, or faker to generate test data. Name constants clearly to document intent.",
      domain: "testing", problemType: "hardcoded_data", severity: "low", confidence: 0.82,
      tags: ["factory", "builder", "faker", "magic-number"],
    },
    {
      title: "Database tests without transaction rollback",
      content: "Test suites that create real database records without cleanup leave residual data affecting later tests. Wrap each test in a transaction and rollback, or use an in-memory database per suite.",
      domain: "testing", problemType: "db_cleanup", severity: "high", confidence: 0.90,
      tags: ["database", "transaction", "rollback", "cleanup"],
    },
    {
      title: "Test suite too slow for CI",
      content: "Large test suites taking 10+ minutes slow development feedback loops. Parallelize tests (vitest --pool threads), use in-memory databases, mock heavy I/O, and split into unit vs integration tiers.",
      domain: "testing", problemType: "slow_tests", severity: "medium", confidence: 0.85,
      tags: ["slow", "parallel", "ci", "optimization"],
    },
    {
      title: "Missing API contract tests",
      content: "Frontend and backend teams changing API shapes independently causes runtime breaks. Add contract tests that validate request/response schemas match the agreed-upon spec (OpenAPI, Zod schemas).",
      domain: "testing", problemType: "contract_tests", severity: "medium", confidence: 0.85,
      tags: ["contract", "api", "schema", "openapi"],
    },
    {
      title: "Console output pollution in test runs",
      content: "console.log/warn/error in tests clutters output and hides real test failures. Mock console in tests or use a logger that's silent in test mode. Assert specific console calls when testing logging.",
      domain: "testing", problemType: "console_pollution", severity: "low", confidence: 0.82,
      tags: ["console", "log", "mock", "output"],
    },
    {
      title: "Test coverage metric gaming",
      content: "Chasing 100% code coverage leads to tests that execute code without meaningful assertions. Focus on mutation testing or assertion coverage. Uncovered code should be intentional and documented.",
      domain: "testing", problemType: "coverage_gaming", severity: "low", confidence: 0.82,
      tags: ["coverage", "mutation", "assertion", "quality"],
    },
    {
      title: "Missing retry logic tests",
      content: "Functions with retry logic need tests for: succeeds on first try, succeeds after N retries, fails after max retries, exponential backoff timing. Use fake timers to verify retry delays.",
      domain: "testing", problemType: "retry_logic", severity: "medium", confidence: 0.85,
      tags: ["retry", "backoff", "fake-timer", "resilience"],
    },
    {
      title: "Unhandled promise rejection in tests",
      content: "Unhandled promise rejections in tests can pass silently in some runners. Use --unhandled-rejections=strict in Node.js. In vitest, unhandled rejections fail the test by default but verify your config.",
      domain: "testing", problemType: "unhandled_rejection", severity: "medium", confidence: 0.85,
      tags: ["promise", "rejection", "unhandled", "strict"],
    },
    {
      title: "Missing WebSocket endpoint tests",
      content: "WebSocket endpoints are often untested because they require special setup. Use ws library's client in tests, connect to the test server, send messages, and assert responses and broadcast behavior.",
      domain: "testing", problemType: "websocket_test", severity: "medium", confidence: 0.85,
      tags: ["websocket", "ws", "endpoint", "integration"],
    },
    {
      title: "Testing private methods directly",
      content: "Accessing private methods via bracket notation or making them public for testing indicates design issues. Test through the public API that calls the private method. Refactor to extract testable utilities.",
      domain: "testing", problemType: "private_method", severity: "low", confidence: 0.82,
      tags: ["private", "public-api", "design", "refactor"],
    },
    {
      title: "Missing concurrent access tests",
      content: "Race conditions only surface under concurrent load. Write tests that fire multiple requests simultaneously (Promise.all), interleave reads/writes, and verify data consistency under contention.",
      domain: "testing", problemType: "concurrency_test", severity: "medium", confidence: 0.85,
      tags: ["concurrency", "race", "parallel", "consistency"],
    },
    {
      title: "Inappropriate use of any in test utilities",
      content: "Using `as any` in test factories and helpers bypasses type safety, letting invalid test data through. Type test utilities properly; use Partial<T> or DeepPartial<T> with sensible defaults.",
      domain: "testing", problemType: "test_any_type", severity: "low", confidence: 0.82,
      tags: ["any", "type-safety", "factory", "partial"],
    },
    {
      title: "Missing environment variable tests",
      content: "Code depending on env vars is often untested for missing or malformed values. Test with process.env manipulation: set required vars, unset them, set invalid values, verify error messages.",
      domain: "testing", problemType: "env_var_test", severity: "medium", confidence: 0.85,
      tags: ["env", "environment", "config", "validation"],
    },
    {
      title: "Test describes without meaningful grouping",
      content: "Flat test files with no describe blocks or meaningless grouping make failures hard to diagnose. Group tests by feature, method, or scenario in nested describes with descriptive names.",
      domain: "testing", problemType: "test_grouping", severity: "low", confidence: 0.80,
      tags: ["describe", "grouping", "organization", "naming"],
    },
    {
      title: "Missing smoke tests for critical paths",
      content: "Unit tests pass but the app crashes on startup because integration wiring is untested. Add smoke tests that boot the app, hit critical endpoints, and verify the happy path works end-to-end.",
      domain: "testing", problemType: "smoke_test", severity: "high", confidence: 0.90,
      tags: ["smoke", "integration", "startup", "critical-path"],
    },
    {
      title: "Mock not restored after test",
      content: "vi.spyOn or jest.fn mocks that aren't restored leak into subsequent tests. Use vi.restoreAllMocks() in afterEach, or call mockRestore() on individual spies. Prefer mockReturnValueOnce over mockReturnValue.",
      domain: "testing", problemType: "mock_restore", severity: "medium", confidence: 0.88,
      tags: ["mock", "restore", "spy", "afterEach"],
    },
  ];
}
