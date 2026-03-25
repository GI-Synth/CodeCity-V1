import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Circular dependency between modules",
      content: "Module A imports B and B imports A, creating fragile coupling and initialization order bugs. Break cycles by extracting shared types into a third module, using dependency injection, or inverting the dependency with an interface.",
      domain: "architecture", problemType: "circular_dependency", severity: "high", confidence: 0.95,
      tags: ["circular", "dependency", "coupling", "module"],
    },
    {
      title: "God object with too many responsibilities",
      content: "A class or module handling 10+ distinct concerns violates Single Responsibility Principle. Signs: >500 lines, imports from many domains, changes for unrelated reasons. Split into focused modules by responsibility.",
      domain: "architecture", problemType: "god_object", severity: "high", confidence: 0.92,
      tags: ["god-object", "srp", "responsibility", "splitting"],
    },
    {
      title: "Feature envy: function uses other module more than its own",
      content: "A function that calls methods or accesses data from another module more than its own belongs in the wrong place. Move it to the module it envies, or extract a shared service both can use.",
      domain: "architecture", problemType: "feature_envy", severity: "medium", confidence: 0.85,
      tags: ["feature-envy", "coupling", "refactor", "cohesion"],
    },
    {
      title: "Shotgun surgery: one change requires edits in many files",
      content: "When a single business change requires editing 5+ files across directories, the concern is scattered. Consolidate related logic into a single module or use a plugin/strategy pattern to centralize the variation point.",
      domain: "architecture", problemType: "shotgun_surgery", severity: "high", confidence: 0.88,
      tags: ["shotgun", "scattered", "change", "consolidate"],
    },
    {
      title: "Divergent change: one module changes for many reasons",
      content: "A module that changes for unrelated reasons (UI updates, business rules, data access) has too many responsibilities. Split into separate modules each with a single reason to change.",
      domain: "architecture", problemType: "divergent_change", severity: "medium", confidence: 0.85,
      tags: ["divergent", "responsibilities", "split", "srp"],
    },
    {
      title: "Missing abstraction layer between UI and business logic",
      content: "UI components directly calling database queries or business rules creates tight coupling. Introduce a service layer that handles business logic, keeping UI components focused on presentation and user interaction.",
      domain: "architecture", problemType: "missing_abstraction", severity: "high", confidence: 0.90,
      tags: ["abstraction", "service-layer", "ui", "separation"],
    },
    {
      title: "Direct database access from route handlers",
      content: "Route handlers that directly query the database skip business logic validation and make testing difficult. Extract a service layer: routes handle HTTP concerns, services handle business logic, repositories handle data access.",
      domain: "architecture", problemType: "layer_violation", severity: "high", confidence: 0.92,
      tags: ["service-layer", "route", "database", "separation"],
    },
    {
      title: "Business logic in React components",
      content: "Complex calculations, validation rules, or state machines in React components make them untestable and non-reusable. Extract business logic into custom hooks or pure utility functions that can be tested independently.",
      domain: "architecture", problemType: "ui_logic_mixing", severity: "medium", confidence: 0.88,
      tags: ["react", "business-logic", "hooks", "separation"],
    },
    {
      title: "Missing error boundaries in React trees",
      content: "Without error boundaries, a single component error crashes the entire app. Add error boundaries at route level, feature level, and around third-party components. Provide fallback UI and error reporting.",
      domain: "architecture", problemType: "error_boundary", severity: "high", confidence: 0.90,
      tags: ["error-boundary", "react", "crash", "fallback"],
    },
    {
      title: "Hardcoded configuration that should be environment-specific",
      content: "Database URLs, API endpoints, feature flags hardcoded in source code prevent deployment to different environments. Use environment variables, config files per environment, or a configuration service.",
      domain: "architecture", problemType: "hardcoded_config", severity: "medium", confidence: 0.90,
      tags: ["config", "environment", "env-vars", "deployment"],
    },
    {
      title: "Monolithic route file handling too many endpoints",
      content: "A single route file with 50+ endpoints is hard to navigate and maintain. Split into domain-specific route modules: /users, /orders, /products, each in its own file with its own middleware stack.",
      domain: "architecture", problemType: "monolith_route", severity: "medium", confidence: 0.85,
      tags: ["routes", "splitting", "modular", "express"],
    },
    {
      title: "Missing dependency injection",
      content: "Hard-wiring dependencies with direct imports prevents testing and swapping implementations. Use constructor injection or a DI container to pass dependencies, enabling mock injection in tests.",
      domain: "architecture", problemType: "dependency_injection", severity: "medium", confidence: 0.85,
      tags: ["di", "injection", "testing", "coupling"],
    },
    {
      title: "Anemic domain model",
      content: "Data classes with only getters/setters and separate procedure functions lose the benefits of encapsulation. Group behavior with the data it operates on. Methods like order.calculateTotal() belong on the Order class, not a separate OrderService.",
      domain: "architecture", problemType: "anemic_model", severity: "medium", confidence: 0.82,
      tags: ["anemic", "domain", "encapsulation", "ddd"],
    },
    {
      title: "Tight coupling to third-party libraries",
      content: "Importing a third-party library directly in 50+ files makes switching libraries extremely painful. Wrap external dependencies in an adapter/facade so internal code depends on your interface, not the library API.",
      domain: "architecture", problemType: "vendor_lock", severity: "medium", confidence: 0.85,
      tags: ["adapter", "facade", "coupling", "vendor"],
    },
    {
      title: "Missing event-driven decoupling",
      content: "When module A directly calls module B, C, and D on every action, they're tightly coupled. Use an event bus or pub/sub pattern so modules react to events independently without knowing about each other.",
      domain: "architecture", problemType: "coupling", severity: "medium", confidence: 0.82,
      tags: ["events", "pub-sub", "decoupling", "bus"],
    },
    {
      title: "Shared mutable state across modules",
      content: "Global variables or singletons with mutable state create race conditions, testing difficulties, and hidden dependencies. Use immutable state, message passing, or scoped state containers like stores.",
      domain: "architecture", problemType: "shared_state", severity: "high", confidence: 0.88,
      tags: ["global", "mutable", "state", "singleton"],
    },
    {
      title: "No clear module boundary or public API",
      content: "When every file imports from any other file's internals, there's no encapsulation. Define index.ts barrel files that export only the public API of each module. Keep implementation details private.",
      domain: "architecture", problemType: "missing_boundary", severity: "medium", confidence: 0.85,
      tags: ["module", "boundary", "barrel", "encapsulation"],
    },
    {
      title: "Database schema coupled to API response shape",
      content: "Returning database rows directly as API responses exposes internal schema and prevents evolution. Map database entities to DTOs/view models, decoupling API contract from storage schema.",
      domain: "architecture", problemType: "schema_coupling", severity: "medium", confidence: 0.85,
      tags: ["dto", "mapping", "schema", "api-contract"],
    },
    {
      title: "Deeply nested directory structure",
      content: "Directory nesting beyond 4 levels (src/features/auth/components/forms/inputs/) makes navigation painful. Flatten to 2-3 levels with clear naming. Group by feature, not by file type.",
      domain: "architecture", problemType: "deep_nesting", severity: "low", confidence: 0.82,
      tags: ["directory", "nesting", "structure", "flat"],
    },
    {
      title: "Mixed concerns in utility files",
      content: "A utils.ts file with string helpers, date formatters, API calls, and validation loses cohesion. Split into focused utilities: stringUtils.ts, dateUtils.ts, apiHelpers.ts. Each file should have one domain.",
      domain: "architecture", problemType: "mixed_utility", severity: "low", confidence: 0.85,
      tags: ["utils", "cohesion", "split", "focused"],
    },
    {
      title: "Missing API versioning strategy",
      content: "Changing API responses without versioning breaks existing clients. Version APIs via URL prefix (/v1/users), Accept header, or query parameter. Plan for backward compatibility from day one.",
      domain: "architecture", problemType: "api_versioning", severity: "medium", confidence: 0.82,
      tags: ["api", "versioning", "backward-compat", "url"],
    },
    {
      title: "Cross-cutting concerns scattered across codebase",
      content: "Logging, auth, validation, error handling duplicated across routes instead of centralized. Use middleware, decorators, or aspect-oriented patterns to apply cross-cutting concerns in one place.",
      domain: "architecture", problemType: "cross_cutting", severity: "medium", confidence: 0.85,
      tags: ["middleware", "cross-cutting", "aop", "centralize"],
    },
    {
      title: "Inappropriate intimacy between modules",
      content: "Two modules accessing each other's internal state or private methods indicates they should be merged or decoupled with an interface. Expose only what's needed through a clean public API.",
      domain: "architecture", problemType: "inappropriate_intimacy", severity: "medium", confidence: 0.82,
      tags: ["intimacy", "coupling", "internal", "refactor"],
    },
    {
      title: "Missing retry and fallback patterns for external services",
      content: "External API calls without retry, timeout, and fallback logic cause cascading failures. Implement circuit breaker pattern, exponential backoff retries, and graceful degradation when services are unavailable.",
      domain: "architecture", problemType: "resilience", severity: "high", confidence: 0.88,
      tags: ["retry", "circuit-breaker", "fallback", "resilience"],
    },
    {
      title: "Leaky abstraction exposing implementation details",
      content: "When a module's interface exposes internal types (database entities, third-party types), consumers are coupled to implementation. Define clean interfaces that hide implementation, translating at the boundary.",
      domain: "architecture", problemType: "leaky_abstraction", severity: "medium", confidence: 0.82,
      tags: ["abstraction", "interface", "leaky", "boundary"],
    },
  ];
}
