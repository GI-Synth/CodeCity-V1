import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing idempotency in event handlers",
      content: "Event handlers or message consumers that aren't idempotent create duplicates when messages are retried. Design handlers to produce the same result regardless of how many times they're called with the same input.",
      domain: "general", problemType: "idempotency", severity: "medium", confidence: 0.85,
      tags: ["idempotent", "event", "handler", "duplicate"],
    },
    {
      title: "Temporal coupling between function calls",
      content: "Functions that must be called in a specific order without enforcement: `init()`, `configure()`, `start()`. Use builder pattern, state machines, or make later steps require outputs of earlier steps.",
      domain: "general", problemType: "temporal_coupling", severity: "medium", confidence: 0.82,
      tags: ["temporal", "coupling", "order", "builder"],
    },
    {
      title: "Leaky abstraction exposing implementation details",
      content: "Abstractions that leak internal details (SQL in error messages, HTTP status codes in business logic) couple consumers to implementation. Keep abstractions opaque; translate errors at boundaries.",
      domain: "general", problemType: "leaky_abstraction", severity: "medium", confidence: 0.82,
      tags: ["abstraction", "leaky", "boundary", "encapsulation"],
    },
    {
      title: "Missing dead code elimination",
      content: "Unused functions, unreachable branches, commented-out code, and deprecated modules add noise and maintenance burden. Remove dead code; version control preserves history if it's needed later.",
      domain: "general", problemType: "dead_code", severity: "low", confidence: 0.85,
      tags: ["dead-code", "unused", "cleanup", "maintenance"],
    },
    {
      title: "Implicit dependencies between modules",
      content: "Module B works only because Module A runs first and sets global state. Make dependencies explicit through function parameters, imports, or dependency injection. Never rely on execution order side effects.",
      domain: "general", problemType: "implicit_dependency", severity: "medium", confidence: 0.85,
      tags: ["implicit", "dependency", "explicit", "order"],
    },
    {
      title: "Thread-unsafe singleton pattern",
      content: "Singleton instances lazily initialized without synchronization can be created multiple times in concurrent environments. Use module-level initialization or atomic compare-and-swap for thread safety.",
      domain: "general", problemType: "singleton_safety", severity: "medium", confidence: 0.82,
      tags: ["singleton", "thread-safe", "concurrent", "initialization"],
    },
    {
      title: "Missing data validation after deserialization",
      content: "JSON.parse, protobuf decode, or msgpack unpack return untyped data. Validate the shape immediately after deserialization with a schema validator (Zod, Joi, Ajv) before using the data.",
      domain: "general", problemType: "deserialization_validation", severity: "high", confidence: 0.90,
      tags: ["deserialization", "validation", "schema", "json"],
    },
    {
      title: "Long-lived feature branches causing merge conflicts",
      content: "Feature branches lasting weeks diverge significantly from main, causing painful merges. Use trunk-based development: small, frequent PRs behind feature flags. Merge daily from main to reduce drift.",
      domain: "general", problemType: "long_branches", severity: "medium", confidence: 0.82,
      tags: ["branch", "merge", "trunk-based", "feature-flag"],
    },
    {
      title: "Missing backwards compatibility in APIs",
      content: "Renaming fields, changing types, or removing endpoints breaks existing clients. Add new fields alongside old ones, support both for a deprecation period, and version your API.",
      domain: "general", problemType: "backwards_compatibility", severity: "high", confidence: 0.88,
      tags: ["backwards", "compatibility", "api", "deprecation"],
    },
    {
      title: "Silently ignoring return values",
      content: "Calling functions that return success/failure indicators without checking the result hides errors. Always check return values, especially from I/O operations, and handle error cases explicitly.",
      domain: "general", problemType: "ignored_return", severity: "medium", confidence: 0.85,
      tags: ["return-value", "ignored", "error", "check"],
    },
    {
      title: "Overengineered solution for simple problem",
      content: "Using design patterns, frameworks, or abstractions beyond what the problem requires adds unnecessary complexity. Start simple, refactor when complexity demands it. YAGNI (You Aren't Gonna Need It).",
      domain: "general", problemType: "overengineering", severity: "low", confidence: 0.82,
      tags: ["yagni", "simple", "overengineering", "complexity"],
    },
    {
      title: "Missing graceful degradation for optional features",
      content: "Application crashes when an optional service (analytics, notifications) is unavailable. Optional features should degrade gracefully: catch errors, log warnings, continue core functionality.",
      domain: "general", problemType: "graceful_degradation", severity: "medium", confidence: 0.85,
      tags: ["degradation", "optional", "resilience", "fallback"],
    },
    {
      title: "Race condition in read-modify-write operations",
      content: "Reading a value, modifying it, and writing back without locks allows concurrent modifications to overwrite each other. Use atomic operations, optimistic locking, or database transactions.",
      domain: "general", problemType: "read_modify_write", severity: "high", confidence: 0.90,
      tags: ["race", "atomic", "lock", "transaction"],
    },
    {
      title: "Missing request validation middleware",
      content: "Validating request bodies in every route handler is repetitive and error-prone. Create reusable validation middleware that validates against Zod schemas and rejects invalid requests with 400.",
      domain: "general", problemType: "validation_middleware", severity: "medium", confidence: 0.85,
      tags: ["validation", "middleware", "zod", "400"],
    },
    {
      title: "Unbounded recursion without depth limit",
      content: "Recursive functions processing user-controlled data (tree traversal, JSON parsing) can cause stack overflow. Add a max depth parameter, convert to iterative with an explicit stack, or tail-call optimize.",
      domain: "general", problemType: "unbounded_recursion", severity: "medium", confidence: 0.85,
      tags: ["recursion", "stack-overflow", "depth", "iterative"],
    },
    {
      title: "Missing observability for async operations",
      content: "Background jobs, queue consumers, and scheduled tasks without logging, metrics, or tracing fail silently. Add structured logging, execution time metrics, and error alerting to all async operations.",
      domain: "general", problemType: "async_observability", severity: "medium", confidence: 0.85,
      tags: ["observability", "async", "logging", "metrics"],
    },
    {
      title: "Configuration spread across multiple sources",
      content: "Configuration from env vars, config files, command-line args, and defaults in multiple places is hard to reason about. Centralize config loading in one module with clear precedence rules and validation.",
      domain: "general", problemType: "config_spread", severity: "medium", confidence: 0.82,
      tags: ["config", "centralize", "precedence", "env"],
    },
    {
      title: "Missing API pagination for list endpoints",
      content: "List endpoints returning all records without pagination crash on large datasets. Add cursor-based or offset pagination with configurable page size, default limits, and max limits.",
      domain: "general", problemType: "missing_pagination", severity: "medium", confidence: 0.88,
      tags: ["pagination", "cursor", "offset", "limit"],
    },
    {
      title: "Mutable shared state between request handlers",
      content: "Module-level arrays or objects modified by request handlers cause race conditions in concurrent requests. Use per-request state, database transactions, or immutable data structures.",
      domain: "general", problemType: "shared_mutable_state", severity: "high", confidence: 0.90,
      tags: ["mutable", "shared", "concurrent", "request"],
    },
    {
      title: "Missing timeout for external service calls",
      content: "HTTP requests to external services without timeouts can hang indefinitely, exhausting connection pools. Set explicit timeouts on all external calls: connect timeout + read timeout.",
      domain: "general", problemType: "missing_timeout", severity: "medium", confidence: 0.88,
      tags: ["timeout", "external", "hang", "connection"],
    },
    {
      title: "Secrets in URL parameters",
      content: "API keys or tokens in URL query strings are logged in server access logs, browser history, and referrer headers. Send secrets in Authorization headers or request body, never in URLs.",
      domain: "general", problemType: "secrets_in_url", severity: "high", confidence: 0.92,
      tags: ["secrets", "url", "header", "authorization"],
    },
    {
      title: "Missing smoke test for deployment verification",
      content: "Deployments without post-deploy verification can ship broken builds. Add automated smoke tests that hit critical endpoints after deployment and roll back on failure.",
      domain: "general", problemType: "deployment_verification", severity: "medium", confidence: 0.85,
      tags: ["smoke-test", "deployment", "verification", "rollback"],
    },
    {
      title: "Error messages exposing internal details",
      content: "Returning stack traces, SQL queries, or file paths in error responses to clients aids attackers. Return sanitized error messages to clients; log full details server-side only.",
      domain: "general", problemType: "error_exposure", severity: "high", confidence: 0.92,
      tags: ["error", "exposure", "sanitize", "client"],
    },
    {
      title: "Missing data backup strategy",
      content: "No automated backups means data loss on failure is permanent. Implement automated backups with retention policies, test restore procedures regularly, and store backups in a different location.",
      domain: "general", problemType: "backup_strategy", severity: "high", confidence: 0.88,
      tags: ["backup", "recovery", "retention", "disaster"],
    },
    {
      title: "Insufficient separation of concerns in routes",
      content: "Express routes containing business logic, data access, and response formatting are hard to test and reuse. Use the service layer pattern: routes → services → repositories, each testable independently.",
      domain: "general", problemType: "route_concerns", severity: "medium", confidence: 0.85,
      tags: ["separation", "service", "repository", "route"],
    },
  ];
}
