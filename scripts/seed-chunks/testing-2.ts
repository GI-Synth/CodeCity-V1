import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing parameterized/table-driven tests",
      content: "Duplicating test logic for each input variant is verbose and error-prone. Use test.each or it.each with a table of inputs and expected outputs to test multiple cases with one test function.",
      domain: "testing", problemType: "parameterized", severity: "low", confidence: 0.82,
      tags: ["each", "table-driven", "parameterized", "DRY"],
    },
    {
      title: "Fragile CSS selector assertions",
      content: "Tests querying by CSS class names (.btn-primary) or DOM structure (div > span:nth-child(2)) break on styling changes. Use data-testid, accessible roles, or text content for queries.",
      domain: "testing", problemType: "fragile_selector", severity: "medium", confidence: 0.85,
      tags: ["selector", "data-testid", "role", "text"],
    },
    {
      title: "E2E tests with hard-coded waits",
      content: "Using `page.waitForTimeout(5000)` makes E2E tests slow and flaky. Use explicit waits: waitForSelector, waitForResponse, or custom polling conditions that complete as soon as the state is ready.",
      domain: "testing", problemType: "hard_wait", severity: "medium", confidence: 0.88,
      tags: ["e2e", "wait", "timeout", "polling"],
    },
    {
      title: "Missing test for race condition in state management",
      content: "State management with concurrent updates can lose events. Test rapid sequential dispatches, out-of-order async resolutions, and verify final state matches regardless of timing.",
      domain: "testing", problemType: "state_race_test", severity: "medium", confidence: 0.82,
      tags: ["race", "state", "concurrent", "dispatch"],
    },
    {
      title: "Incomplete cleanup of test server instances",
      content: "Test server instances not closed after tests leak file descriptors and ports, causing 'EADDRINUSE' on subsequent runs. Always close servers in afterAll and verify port is released.",
      domain: "testing", problemType: "server_cleanup", severity: "high", confidence: 0.90,
      tags: ["server", "cleanup", "port", "EADDRINUSE"],
    },
    {
      title: "Unnecessary network calls in unit tests",
      content: "Unit tests hitting real APIs are slow, flaky, and dependent on network. Mock HTTP clients with msw (Mock Service Worker) or nock for reliable, fast tests that don't require network access.",
      domain: "testing", problemType: "network_calls", severity: "medium", confidence: 0.88,
      tags: ["network", "mock", "msw", "nock"],
    },
    {
      title: "Test fixture files checked into wrong location",
      content: "Test fixtures (JSON, images) scattered across the project are hard to find. Create a __fixtures__ or test-data directory co-located with tests. Keep fixtures small and version them with the test.",
      domain: "testing", problemType: "fixture_location", severity: "low", confidence: 0.80,
      tags: ["fixture", "data", "organization", "location"],
    },
    {
      title: "Missing load/performance test for API endpoints",
      content: "APIs performing well in development can degrade under load. Run autocannon, k6, or artillery load tests against critical endpoints. Set response time SLOs and alert on regressions in CI.",
      domain: "testing", problemType: "load_test", severity: "medium", confidence: 0.82,
      tags: ["load", "performance", "k6", "autocannon"],
    },
    {
      title: "Inconsistent assertion style within test suite",
      content: "Mixing expect().toBe(), assert.equal(), and manual if/throw in the same suite confuses developers. Standardize on one assertion library (vitest expect, chai, etc.) across the project.",
      domain: "testing", problemType: "assertion_style", severity: "low", confidence: 0.80,
      tags: ["assertion", "style", "consistency", "expect"],
    },
    {
      title: "Missing boundary value analysis in numeric tests",
      content: "Only testing mid-range values misses off-by-one bugs. Test: 0, 1, -1, MAX_SAFE_INTEGER, NaN, Infinity, and boundary values at domain limits (e.g., array empty, array length 1).",
      domain: "testing", problemType: "boundary_values", severity: "medium", confidence: 0.85,
      tags: ["boundary", "off-by-one", "numeric", "edge-case"],
    },
    {
      title: "Test helper with hidden side effects",
      content: "Test setup functions that modify global state, create files, or start services without documenting it cause mysterious failures. Make setup functions return cleanup handles and document side effects.",
      domain: "testing", problemType: "helper_side_effects", severity: "medium", confidence: 0.82,
      tags: ["helper", "side-effect", "setup", "cleanup"],
    },
    {
      title: "Missing tests for middleware error handling",
      content: "Express middleware error handlers are rarely tested but critical for security. Test that errors return correct status codes, don't leak stack traces in production, and log appropriately.",
      domain: "testing", problemType: "middleware_test", severity: "medium", confidence: 0.85,
      tags: ["middleware", "error", "express", "status-code"],
    },
    {
      title: "Ignoring test failures with skip/pending",
      content: "Tests marked with .skip or .todo pile up over time and hide regressions. Track skipped tests as tech debt. If a test is permanently irrelevant, delete it; if temporary, add a ticket reference.",
      domain: "testing", problemType: "skipped_tests", severity: "low", confidence: 0.82,
      tags: ["skip", "todo", "pending", "tech-debt"],
    },
    {
      title: "Missing test for file upload/download",
      content: "File handling endpoints need tests for: valid upload, oversized files, wrong MIME types, empty files, special characters in filenames, and download with correct Content-Type/Disposition headers.",
      domain: "testing", problemType: "file_test", severity: "medium", confidence: 0.85,
      tags: ["upload", "download", "file", "mime"],
    },
    {
      title: "Testing only the ORM layer not raw queries",
      content: "If you use raw SQL alongside an ORM, the raw queries need separate testing. ORMs abstract away SQL bugs, but raw queries can have injection risks, syntax errors, or schema mismatches.",
      domain: "testing", problemType: "raw_query_test", severity: "medium", confidence: 0.82,
      tags: ["orm", "raw-sql", "query", "injection"],
    },
    {
      title: "No visual regression tests for UI components",
      content: "CSS changes that break visual layout are invisible to unit tests. Use visual regression tools (Chromatic, Percy, Playwright screenshots) to catch unintended visual changes in PRs.",
      domain: "testing", problemType: "visual_regression", severity: "low", confidence: 0.80,
      tags: ["visual", "regression", "screenshot", "css"],
    },
    {
      title: "Missing test for graceful shutdown",
      content: "Applications that don't handle SIGTERM/SIGINT gracefully drop in-flight requests. Test that the server drains connections, finishes current requests, and closes database connections on shutdown.",
      domain: "testing", problemType: "graceful_shutdown", severity: "medium", confidence: 0.85,
      tags: ["shutdown", "graceful", "SIGTERM", "drain"],
    },
    {
      title: "Cypress/Playwright tests not cleaning up auth state",
      content: "E2E tests that create user accounts or sessions without cleanup leave residual state. Use test-specific auth tokens, seed fresh users per test, or reset auth state in test teardown.",
      domain: "testing", problemType: "auth_cleanup", severity: "medium", confidence: 0.85,
      tags: ["e2e", "auth", "cleanup", "session"],
    },
    {
      title: "Testing date-dependent logic without mocking time",
      content: "Tests for expiration, scheduling, or age calculations that use real Date.now() break as time passes. Mock Date.now with vi.setSystemTime or inject a clock dependency for deterministic results.",
      domain: "testing", problemType: "date_mocking", severity: "medium", confidence: 0.88,
      tags: ["date", "time", "mock", "deterministic"],
    },
    {
      title: "Missing tests for pagination edge cases",
      content: "Pagination tests often cover page 1 only. Test: page 0, negative page, page beyond total, exact boundary (total % pageSize === 0), single item total, and empty result set.",
      domain: "testing", problemType: "pagination_test", severity: "medium", confidence: 0.85,
      tags: ["pagination", "edge-case", "boundary", "empty"],
    },
    {
      title: "Asserting on unstable ordering",
      content: "Tests asserting array order when the source doesn't guarantee order (Set, Map iteration, concurrent DB queries) are flaky. Sort before asserting, or use toContainEqual / arrayContaining matchers.",
      domain: "testing", problemType: "unstable_order", severity: "medium", confidence: 0.85,
      tags: ["order", "sort", "assertion", "flaky"],
    },
    {
      title: "Test that only checks truthiness not value",
      content: "`expect(result).toBeTruthy()` passes for any truthy value including unexpected ones. Use specific assertions: toBe(42), toEqual({id:1}), toHaveLength(3) for precise and informative failures.",
      domain: "testing", problemType: "truthy_assertion", severity: "low", confidence: 0.82,
      tags: ["assertion", "truthy", "specific", "value"],
    },
    {
      title: "Missing negative test for authorization",
      content: "Testing that authorized users CAN access resources is important, but testing that unauthorized users CANNOT is critical. Verify 401/403 responses for missing tokens, expired tokens, and wrong roles.",
      domain: "testing", problemType: "auth_negative", severity: "high", confidence: 0.92,
      tags: ["authorization", "negative", "401", "403"],
    },
    {
      title: "Long test names without describe context",
      content: "'it should return 404 when user ID does not exist in database after soft delete' is too long. Use nested describes for context: describe('GET /users/:id') > describe('soft-deleted') > it('returns 404').",
      domain: "testing", problemType: "test_naming", severity: "low", confidence: 0.80,
      tags: ["naming", "describe", "context", "readability"],
    },
    {
      title: "Missing test for concurrent database writes",
      content: "Concurrent INSERT/UPDATE operations can violate unique constraints or cause lost updates. Test by firing parallel writes and asserting correct final state. Use transactions or optimistic locking.",
      domain: "testing", problemType: "concurrent_db", severity: "medium", confidence: 0.85,
      tags: ["concurrent", "database", "write", "lock"],
    },
  ];
}
