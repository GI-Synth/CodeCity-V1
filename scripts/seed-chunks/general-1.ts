import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Magic numbers in business logic",
      content: "Hardcoded numbers like `if (status === 3)` or `timeout: 86400000` are unreadable. Extract to named constants: `const STATUS_APPROVED = 3`, `const ONE_DAY_MS = 86_400_000`. Use enums for finite sets.",
      domain: "general", problemType: "magic_number", severity: "medium", confidence: 0.85,
      tags: ["magic-number", "constant", "enum", "readability"],
    },
    {
      title: "God object/class with too many responsibilities",
      content: "A class with 1000+ lines handling database access, business logic, validation, and formatting violates SRP. Split into focused classes: Repository, Service, Validator, Formatter—each with one reason to change.",
      domain: "general", problemType: "god_class", severity: "medium", confidence: 0.85,
      tags: ["srp", "god-class", "refactor", "responsibility"],
    },
    {
      title: "Copy-paste code duplication",
      content: "Duplicated code blocks diverge over time as fixes apply to one copy but not others. Extract shared logic into functions, modules, or shared utilities. DRY principle reduces bug surface area.",
      domain: "general", problemType: "duplication", severity: "medium", confidence: 0.88,
      tags: ["dry", "duplication", "extract", "utility"],
    },
    {
      title: "Nested callback hell",
      content: "Deeply nested callbacks create pyramid-shaped code that's unreadable and error-prone. Refactor to async/await, Promise chains, or extract named functions. Each nesting level adds cognitive load.",
      domain: "general", problemType: "callback_hell", severity: "medium", confidence: 0.88,
      tags: ["callback", "nesting", "async", "readability"],
    },
    {
      title: "Inconsistent naming conventions across codebase",
      content: "Mixing camelCase, snake_case, PascalCase, and kebab-case randomly makes code hard to navigate. Establish and enforce conventions: camelCase for variables/functions, PascalCase for types/classes, kebab-case for files.",
      domain: "general", problemType: "naming_convention", severity: "low", confidence: 0.85,
      tags: ["naming", "convention", "camelCase", "consistency"],
    },
    {
      title: "Boolean parameters creating ambiguous APIs",
      content: "`createUser(name, true, false, true)` is unreadable. Use options objects: `createUser(name, { admin: true, active: false, verified: true })` or separate named functions for clarity.",
      domain: "general", problemType: "boolean_params", severity: "low", confidence: 0.82,
      tags: ["boolean", "parameter", "options", "readability"],
    },
    {
      title: "Early return pattern not applied",
      content: "Deep nesting from if/else chains when early returns would flatten the code. Invert conditions and return early: `if (!valid) return error;` then continue with happy path at base indentation level.",
      domain: "general", problemType: "early_return", severity: "low", confidence: 0.85,
      tags: ["early-return", "guard", "nesting", "readability"],
    },
    {
      title: "Missing input sanitization at system boundaries",
      content: "User input, file uploads, API responses, and database results are untrusted boundaries. Sanitize and validate at every boundary crossing. Don't trust internal data either if it originated externally.",
      domain: "general", problemType: "input_sanitization", severity: "high", confidence: 0.92,
      tags: ["sanitization", "boundary", "validation", "trust"],
    },
    {
      title: "Using mutable global state",
      content: "Global mutable variables create hidden dependencies, race conditions, and testing nightmares. Use dependency injection, module-level singletons with explicit initialization, or state management patterns.",
      domain: "general", problemType: "global_state", severity: "high", confidence: 0.90,
      tags: ["global", "mutable", "singleton", "dependency-injection"],
    },
    {
      title: "Function doing too many things",
      content: "Functions that validate, transform, persist, and notify violate single responsibility. Each function should do one thing well. Break into: validate(), transform(), persist(), notify() and compose them.",
      domain: "general", problemType: "function_size", severity: "medium", confidence: 0.85,
      tags: ["function", "srp", "extract", "compose"],
    },
    {
      title: "Ignoring compiler/linter warnings",
      content: "Suppressing or ignoring compiler warnings hides real bugs. Fix warnings, upgrade deprecated APIs, type errors, and unused variables. Aim for zero warnings in CI. Use strict lint configs.",
      domain: "general", problemType: "ignored_warnings", severity: "medium", confidence: 0.85,
      tags: ["warning", "lint", "strict", "ci"],
    },
    {
      title: "Premature optimization without profiling",
      content: "Optimizing code without profiling wastes time on non-bottlenecks. Profile first (Chrome DevTools, clinic.js, perf), identify actual bottlenecks, then optimize with benchmarks to verify improvement.",
      domain: "general", problemType: "premature_optimization", severity: "low", confidence: 0.85,
      tags: ["optimization", "profiling", "benchmark", "bottleneck"],
    },
    {
      title: "Tight coupling between modules",
      content: "Module A directly importing internals of Module B makes both fragile. Depend on interfaces/contracts, not implementations. Use dependency injection and keep module boundaries clean.",
      domain: "general", problemType: "tight_coupling", severity: "medium", confidence: 0.85,
      tags: ["coupling", "interface", "dependency-injection", "boundary"],
    },
    {
      title: "Catch block swallowing exceptions",
      content: "Empty catch blocks or `catch(e) { console.log(e) }` hide failures. Either handle the error explicitly, rethrow with context, or let it propagate. Log with sufficient detail for debugging.",
      domain: "general", problemType: "swallowed_exception", severity: "high", confidence: 0.90,
      tags: ["catch", "exception", "swallow", "rethrow"],
    },
    {
      title: "Inconsistent error handling strategy",
      content: "Mixing throw/catch, return null, error codes, and Result types in the same codebase confuses developers. Standardize: use exceptions for unexpected errors, Result types for expected failures.",
      domain: "general", problemType: "error_strategy", severity: "medium", confidence: 0.85,
      tags: ["error", "strategy", "result", "exception"],
    },
    {
      title: "Missing feature toggles for deployments",
      content: "Deploying incomplete features behind no toggle means either long-lived branches or exposing unfinished work. Use feature flags to deploy code to production disabled, then enable when ready.",
      domain: "general", problemType: "feature_toggle", severity: "medium", confidence: 0.82,
      tags: ["feature-flag", "toggle", "deployment", "trunk-based"],
    },
    {
      title: "Hard-coded configuration values",
      content: "URLs, timeouts, limits, and feature switches hardcoded in source require redeployment to change. Externalize to environment variables, config files, or a configuration service.",
      domain: "general", problemType: "hardcoded_config", severity: "medium", confidence: 0.85,
      tags: ["config", "hardcoded", "env", "externalize"],
    },
    {
      title: "Missing retry logic for transient failures",
      content: "Network calls, database queries, and external API requests can fail transiently. Add retry with exponential backoff for idempotent operations. Set max retries and circuit breakers for persistent failures.",
      domain: "general", problemType: "missing_retry", severity: "medium", confidence: 0.85,
      tags: ["retry", "exponential-backoff", "circuit-breaker", "resilience"],
    },
    {
      title: "Stringly-typed code instead of proper types",
      content: "Using strings for status ('active', 'inactive'), types ('admin', 'user'), or IDs loses type safety. Use enums, union types, branded types, or dedicated ID types for compile-time validation.",
      domain: "general", problemType: "stringly_typed", severity: "medium", confidence: 0.85,
      tags: ["string", "enum", "union", "type-safety"],
    },
    {
      title: "Missing null/undefined checks at boundaries",
      content: "Functions that assume non-null inputs crash on null/undefined from external sources. Validate at boundaries: API responses, user input, database results. Use Optional chaining (?.) defensively at edges.",
      domain: "general", problemType: "null_check", severity: "medium", confidence: 0.85,
      tags: ["null", "undefined", "optional-chaining", "boundary"],
    },
    {
      title: "Improper use of inheritance over composition",
      content: "Deep inheritance hierarchies (5+ levels) create fragile base class problem. Prefer composition: inject behaviors via constructor params or mixins. 'Has-a' is usually better than 'is-a'.",
      domain: "general", problemType: "inheritance_composition", severity: "medium", confidence: 0.82,
      tags: ["inheritance", "composition", "mixin", "design"],
    },
    {
      title: "Side effects in constructors",
      content: "Constructors that make HTTP calls, read files, or start timers make classes hard to test and surprise callers. Keep constructors pure, use factory methods or initialize() for side effects.",
      domain: "general", problemType: "constructor_side_effects", severity: "medium", confidence: 0.85,
      tags: ["constructor", "side-effect", "factory", "pure"],
    },
    {
      title: "Version pinning vs range in dependencies",
      content: "Using `^` ranges allows minor version bumps that can introduce bugs. Pin exact versions for production apps. Use Renovate/Dependabot for structured updates. Libraries can use ranges.",
      domain: "general", problemType: "version_pinning", severity: "low", confidence: 0.80,
      tags: ["version", "pin", "dependency", "renovate"],
    },
    {
      title: "Missing circuit breaker for external services",
      content: "Calling a failing external service repeatedly wastes resources and degrades your system. Implement a circuit breaker: after N failures, stop calling for a cooldown period, then probe with a test request.",
      domain: "general", problemType: "circuit_breaker", severity: "medium", confidence: 0.85,
      tags: ["circuit-breaker", "resilience", "external", "cooldown"],
    },
    {
      title: "Logging without structured context",
      content: "Unstructured log messages like 'Error occurred' are useless for debugging. Include: timestamp, request ID, user ID, operation name, error details, and duration. Use JSON structured logging.",
      domain: "general", problemType: "logging_context", severity: "medium", confidence: 0.85,
      tags: ["logging", "structured", "context", "json"],
    },
  ];
}
