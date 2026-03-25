import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing health check endpoint",
      content: "Without /health, load balancers and orchestrators can't detect unhealthy instances. Implement a health endpoint that checks database connectivity, external service availability, and returns status with response time.",
      domain: "architecture", problemType: "health_check", severity: "medium", confidence: 0.88,
      tags: ["health", "monitoring", "load-balancer", "endpoint"],
    },
    {
      title: "Temporal coupling in initialization",
      content: "Requiring functions to be called in a specific order (init before use) creates brittle code. Use lazy initialization, builder pattern, or constructor injection to enforce valid state from creation.",
      domain: "architecture", problemType: "temporal_coupling", severity: "medium", confidence: 0.82,
      tags: ["temporal", "initialization", "coupling", "builder"],
    },
    {
      title: "Feature flag system missing or ad-hoc",
      content: "Using if/else for features across the codebase makes management impossible. Centralize feature flags in a config or service (LaunchDarkly, Unleash, or simple env vars with a typed config object).",
      domain: "architecture", problemType: "feature_flags", severity: "low", confidence: 0.80,
      tags: ["feature-flag", "config", "toggle", "deployment"],
    },
    {
      title: "Missing structured error types",
      content: "Using generic Error for all failures requires string parsing to handle specific cases. Define error classes: NotFoundError, ValidationError, AuthError. Include error codes for machine-readable handling.",
      domain: "architecture", problemType: "error_types", severity: "medium", confidence: 0.85,
      tags: ["error", "types", "classification", "handling"],
    },
    {
      title: "Data transformation logic scattered across layers",
      content: "Mapping, formatting, and transforming data in routes, components, and services creates inconsistency. Centralize transformations in mapper/transformer functions at layer boundaries.",
      domain: "architecture", problemType: "scattered_transform", severity: "medium", confidence: 0.82,
      tags: ["transform", "mapping", "centralize", "boundary"],
    },
    {
      title: "Over-engineering with premature abstractions",
      content: "Creating interfaces, factories, and abstractions before having multiple implementations adds complexity without benefit. Follow Rule of Three: abstract when you see the same pattern third time. Prefer simple and direct.",
      domain: "architecture", problemType: "over_engineering", severity: "medium", confidence: 0.85,
      tags: ["abstraction", "premature", "yagni", "simplicity"],
    },
    {
      title: "Missing graceful degradation for optional features",
      content: "When an optional feature (analytics, search, recommendations) fails, the entire request shouldn't fail. Use try/catch around optional features and serve the core response even when extras fail.",
      domain: "architecture", problemType: "graceful_degradation", severity: "medium", confidence: 0.85,
      tags: ["graceful", "degradation", "optional", "resilience"],
    },
    {
      title: "Bidirectional data flow in component trees",
      content: "Child components modifying parent state via callbacks nested 3+ levels deep creates spaghetti data flow. Use context, state management, or event buses for deeply nested communication.",
      domain: "architecture", problemType: "data_flow", severity: "medium", confidence: 0.85,
      tags: ["data-flow", "props", "context", "state"],
    },
    {
      title: "Configuration spread across multiple sources",
      content: "Reading config from env vars, JSON files, command-line args, and defaults in different files is error-prone. Centralize into a single config module that merges all sources with clear precedence and validation.",
      domain: "architecture", problemType: "config_spread", severity: "medium", confidence: 0.85,
      tags: ["config", "centralize", "validation", "precedence"],
    },
    {
      title: "Test infrastructure coupled to production code",
      content: "Test utilities, mocks, and fixtures imported into production code blur boundaries. Keep test infrastructure in test directories only. Production code should not import from test paths.",
      domain: "architecture", problemType: "test_coupling", severity: "medium", confidence: 0.82,
      tags: ["test", "production", "coupling", "boundary"],
    },
    {
      title: "Missing transaction boundaries in multi-step operations",
      content: "Multi-step database operations without transactions leave data in inconsistent states on failure. Wrap related writes in database transactions with rollback on error.",
      domain: "architecture", problemType: "transaction", severity: "high", confidence: 0.90,
      tags: ["transaction", "database", "consistency", "rollback"],
    },
    {
      title: "Implicit dependencies via global imports",
      content: "Modules depending on global side effects (registering plugins, modifying prototypes) create hidden coupling. Make dependencies explicit through parameters or dependency injection.",
      domain: "architecture", problemType: "implicit_deps", severity: "medium", confidence: 0.82,
      tags: ["global", "implicit", "side-effect", "explicit"],
    },
    {
      title: "API endpoint naming inconsistency",
      content: "Mixing naming conventions (/getUsers, /user/create, /users, /api/v1/Users) confuses consumers. Adopt consistent REST conventions: plural nouns for resources, HTTP methods for actions, lowercase kebab-case.",
      domain: "architecture", problemType: "naming_consistency", severity: "low", confidence: 0.82,
      tags: ["api", "naming", "rest", "consistency"],
    },
    {
      title: "Missing observability (metrics, tracing, logging)",
      content: "Without structured metrics and distributed tracing, debugging production issues is guesswork. Add request tracing IDs, structured JSON logging, and key metrics (latency, error rate, throughput).",
      domain: "architecture", problemType: "observability", severity: "high", confidence: 0.85,
      tags: ["observability", "tracing", "metrics", "logging"],
    },
    {
      title: "Coupling to file system in business logic",
      content: "Business logic that directly reads/writes files can't be tested without a real filesystem. Abstract file I/O behind an interface (FileStorage), enabling in-memory implementations for testing.",
      domain: "architecture", problemType: "file_coupling", severity: "medium", confidence: 0.82,
      tags: ["file-system", "abstraction", "testing", "interface"],
    },
    {
      title: "Missing idempotency on write operations",
      content: "Non-idempotent endpoints (POST /create) can create duplicates on retries. Use idempotency keys, check-and-insert patterns, or natural unique constraints to make write operations safe to retry.",
      domain: "architecture", problemType: "idempotency", severity: "medium", confidence: 0.85,
      tags: ["idempotent", "retry", "duplicate", "key"],
    },
    {
      title: "Synchronous inter-service communication",
      content: "Service A waiting for Service B on every request creates latency chains and cascade failures. Use async messaging (queues, events) for non-critical paths. Keep synchronous calls for essential request/response only.",
      domain: "architecture", problemType: "sync_communication", severity: "medium", confidence: 0.82,
      tags: ["async", "messaging", "queue", "microservice"],
    },
    {
      title: "Violation of open-closed principle",
      content: "Adding a new feature type requires modifying existing switch statements or if/else chains across the codebase. Use strategy pattern, plugin architecture, or polymorphism to extend behavior without modifying existing code.",
      domain: "architecture", problemType: "open_closed", severity: "medium", confidence: 0.82,
      tags: ["open-closed", "strategy", "polymorphism", "extension"],
    },
    {
      title: "Missing database migration strategy",
      content: "Ad-hoc ALTER TABLE statements and manual schema changes cause deployment failures and data loss. Use a migration tool (drizzle-kit, knex migrate, prisma migrate) with versioned, reversible migrations checked into version control.",
      domain: "architecture", problemType: "migration", severity: "high", confidence: 0.88,
      tags: ["migration", "schema", "database", "versioning"],
    },
    {
      title: "Excessive middleware chain on all routes",
      content: "Applying all middleware globally when only some routes need it wastes CPU and complicates debugging. Group routes by middleware needs: public routes (minimal), authenticated routes (auth + logging), admin routes (auth + rbac + audit).",
      domain: "architecture", problemType: "middleware_config", severity: "low", confidence: 0.80,
      tags: ["middleware", "routes", "grouping", "performance"],
    },
    {
      title: "State management without clear ownership",
      content: "When it's unclear which module owns and manages a piece of state, bugs arise from conflicting updates. Define clear state ownership: one module writes, others read. Use events to notify observers of changes.",
      domain: "architecture", problemType: "state_ownership", severity: "medium", confidence: 0.82,
      tags: ["state", "ownership", "single-writer", "events"],
    },
    {
      title: "Missing rate limiting strategy",
      content: "Without rate limiting, APIs are vulnerable to abuse and resource exhaustion. Implement tiered rate limiting: generous for reads, strict for writes, very strict for auth endpoints. Use sliding window algorithms.",
      domain: "architecture", problemType: "rate_limiting", severity: "high", confidence: 0.88,
      tags: ["rate-limit", "throttle", "sliding-window", "abuse"],
    },
    {
      title: "Test data management anti-patterns",
      content: "Shared test fixtures that tests modify create flaky order-dependent tests. Each test should create its own data, use transactions with rollback, or reset state in beforeEach.",
      domain: "architecture", problemType: "test_data", severity: "medium", confidence: 0.85,
      tags: ["test-data", "fixtures", "isolation", "flaky"],
    },
    {
      title: "Improper separation of read and write models",
      content: "Complex queries joining many tables for both reads and writes create performance issues. Consider CQRS light: separate read-optimized views/queries from write-focused mutations, especially at scale.",
      domain: "architecture", problemType: "cqrs", severity: "low", confidence: 0.80,
      tags: ["cqrs", "read-model", "write-model", "separation"],
    },
    {
      title: "Missing backward compatibility in shared libraries",
      content: "Breaking changes in shared internal libraries force all consumers to update simultaneously. Follow semver, deprecate before removing, provide migration guides, and support N-1 version for transition periods.",
      domain: "architecture", problemType: "backward_compat", severity: "medium", confidence: 0.82,
      tags: ["backward-compat", "semver", "library", "breaking"],
    },
  ];
}
