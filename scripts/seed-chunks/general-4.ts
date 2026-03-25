import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing distributed tracing for microservices",
      content: "In microservice architectures, requests span multiple services. Without distributed tracing (OpenTelemetry, Jaeger), debugging latency or failures across services is nearly impossible. Propagate trace context in headers.",
      domain: "general", problemType: "distributed_tracing", severity: "medium", confidence: 0.82,
      tags: ["tracing", "opentelemetry", "microservice", "jaeger"],
    },
    {
      title: "Double submission vulnerability in forms",
      content: "Users clicking submit twice can create duplicate records. Disable the submit button after first click, use idempotency tokens server-side, and debounce the submit handler client-side.",
      domain: "general", problemType: "double_submit", severity: "medium", confidence: 0.85,
      tags: ["double-submit", "idempotency", "debounce", "form"],
    },
    {
      title: "Missing cache headers for static assets",
      content: "Static files (JS, CSS, images) served without Cache-Control headers are re-downloaded on every visit. Set long cache durations with content-hash filenames, or use ETag/Last-Modified for validation.",
      domain: "general", problemType: "cache_headers", severity: "medium", confidence: 0.85,
      tags: ["cache", "headers", "static", "etag"],
    },
    {
      title: "Unbounded queue growth without backpressure",
      content: "In-memory queues that grow without limit when consumers are slower than producers cause OOM. Set maximum queue size, apply backpressure (reject or block producers), and monitor queue depth.",
      domain: "general", problemType: "queue_backpressure", severity: "medium", confidence: 0.85,
      tags: ["queue", "backpressure", "oom", "producer"],
    },
    {
      title: "Missing CSRF protection on state-changing endpoints",
      content: "State-changing requests (POST, PUT, DELETE) without CSRF tokens allow cross-site attacks that perform actions on behalf of authenticated users. Use CSRF tokens or SameSite cookies for protection.",
      domain: "general", problemType: "csrf", severity: "high", confidence: 0.90,
      tags: ["csrf", "token", "sameSite", "security"],
    },
    {
      title: "Inconsistent API naming conventions",
      content: "Mixing /getUsers, /users/list, /user-management/fetch across endpoints confuses consumers. Standardize: use nouns for resources (/users), HTTP methods for actions, and consistent plural/singular.",
      domain: "general", problemType: "api_naming", severity: "low", confidence: 0.82,
      tags: ["api", "naming", "rest", "convention"],
    },
    {
      title: "Missing automated security scanning in CI",
      content: "Manual security reviews miss known vulnerability patterns. Add automated tools in CI: npm audit for dependencies, Semgrep/ESLint security plugins for code, and Trivy for container images.",
      domain: "general", problemType: "security_scanning", severity: "medium", confidence: 0.85,
      tags: ["security", "scanning", "ci", "audit"],
    },
    {
      title: "Large file uploads blocking the event loop",
      content: "Processing uploaded files synchronously (parsing CSV, resizing images) blocks the Node.js event loop. Stream large files, process in worker threads, or offload to a background job queue.",
      domain: "general", problemType: "upload_blocking", severity: "medium", confidence: 0.85,
      tags: ["upload", "blocking", "stream", "worker"],
    },
    {
      title: "Missing blue-green or canary deployment strategy",
      content: "Direct deployment to all instances simultaneously risks full outage on bad releases. Use blue-green deployments (switch traffic) or canary releases (gradual rollout with monitoring) for safer deploys.",
      domain: "general", problemType: "deployment_strategy", severity: "medium", confidence: 0.82,
      tags: ["deployment", "blue-green", "canary", "rollout"],
    },
    {
      title: "Excessive reliance on comments instead of clean code",
      content: "Heavy commenting of unclear code is a code smell. Rename variables, extract functions, and restructure code to be self-documenting. Comments should explain why, not what the code does.",
      domain: "general", problemType: "comments_vs_code", severity: "low", confidence: 0.82,
      tags: ["comments", "clean-code", "naming", "readability"],
    },
    {
      title: "Missing database connection error handling",
      content: "Database connections failing without retry or fallback crashes the application. Implement connection retry with backoff, health-check the connection before queries, and fail gracefully with error pages.",
      domain: "general", problemType: "db_connection_error", severity: "high", confidence: 0.88,
      tags: ["database", "connection", "retry", "resilience"],
    },
    {
      title: "Improper session management",
      content: "Long-lived sessions, sessions that don't regenerate IDs on login, or sessions stored only in memory are security risks. Regenerate session IDs on auth changes, set reasonable expiry, use secure storage.",
      domain: "general", problemType: "session_management", severity: "high", confidence: 0.90,
      tags: ["session", "security", "regenerate", "expiry"],
    },
    {
      title: "Missing SLA monitoring for dependencies",
      content: "When external services degrade, you need to know before users report it. Monitor response times, error rates, and availability of all dependencies. Set alerts based on agreed SLA thresholds.",
      domain: "general", problemType: "sla_monitoring", severity: "medium", confidence: 0.82,
      tags: ["sla", "monitoring", "dependency", "alert"],
    },
    {
      title: "Insufficient data anonymization for non-production",
      content: "Using production data in staging/development without anonymization violates privacy regulations. Mask PII (emails, names, addresses) in non-production environments. Use synthetic data generators.",
      domain: "general", problemType: "data_anonymization", severity: "high", confidence: 0.88,
      tags: ["anonymization", "pii", "privacy", "synthetic"],
    },
    {
      title: "Missing OpenGraph and meta tags for shared links",
      content: "URLs shared on social media or messaging apps without OpenGraph meta tags show generic previews. Add og:title, og:description, og:image, and Twitter card meta tags for rich link previews.",
      domain: "general", problemType: "meta_tags", severity: "low", confidence: 0.80,
      tags: ["opengraph", "meta", "seo", "social"],
    },
    {
      title: "Incorrect use of HTTP status codes",
      content: "Returning 200 for errors, 404 for authorization failures, or 500 for validation errors confuses clients. Use correct codes: 400 bad request, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict.",
      domain: "general", problemType: "status_codes", severity: "medium", confidence: 0.85,
      tags: ["status-code", "http", "rest", "error"],
    },
    {
      title: "Missing data integrity constraints in database",
      content: "Relying solely on application code for data integrity allows invalid data from direct DB access, migrations, or bugs. Add NOT NULL, UNIQUE, FOREIGN KEY, and CHECK constraints at the database level.",
      domain: "general", problemType: "db_constraints", severity: "medium", confidence: 0.88,
      tags: ["constraint", "database", "integrity", "foreign-key"],
    },
    {
      title: "Sprawling configuration with no defaults",
      content: "Requiring 20+ environment variables with no defaults makes local development painful. Provide sensible defaults for development, require explicit configuration only for production-specific values.",
      domain: "general", problemType: "config_defaults", severity: "low", confidence: 0.82,
      tags: ["config", "defaults", "environment", "development"],
    },
    {
      title: "Missing load shedding for overloaded services",
      content: "Under extreme load, processing all requests slowly is worse than rejecting some quickly. Implement load shedding: monitor queue depth or CPU, return 503 Service Unavailable when thresholds are exceeded.",
      domain: "general", problemType: "load_shedding", severity: "medium", confidence: 0.82,
      tags: ["load-shedding", "503", "overload", "resilience"],
    },
    {
      title: "Improper handling of Unicode and special characters",
      content: "Assuming ASCII-only input causes bugs with international names, emoji, and special characters. Use UTF-8 throughout, test with unicode inputs (Chinese, Arabic, emoji), and handle string length correctly.",
      domain: "general", problemType: "unicode", severity: "medium", confidence: 0.82,
      tags: ["unicode", "utf8", "internationalization", "emoji"],
    },
    {
      title: "Missing API response compression",
      content: "Large JSON responses sent uncompressed waste bandwidth and increase load times. Enable gzip/brotli compression middleware. Most HTTP clients automatically decompress, reducing transfer sizes by 60-80%.",
      domain: "general", problemType: "response_compression", severity: "low", confidence: 0.82,
      tags: ["compression", "gzip", "brotli", "bandwidth"],
    },
    {
      title: "Database enum as string without validation",
      content: "Storing enum values as unconstrained strings in the database allows invalid values. Use CHECK constraints, Drizzle enums, or application-level validation to ensure only valid enum values are persisted.",
      domain: "general", problemType: "enum_validation", severity: "medium", confidence: 0.85,
      tags: ["enum", "database", "check", "validation"],
    },
    {
      title: "Missing fallback UI for loading states",
      content: "White screens during data loading feel broken. Show skeleton loaders, spinners, or cached data for every async operation. Ensure users always see feedback that the app is working.",
      domain: "general", problemType: "loading_fallback", severity: "medium", confidence: 0.85,
      tags: ["loading", "skeleton", "spinner", "ux"],
    },
    {
      title: "Incorrect cache TTL causing stale data",
      content: "Cache TTL too long serves stale data; too short negates caching benefits. Set TTL based on data change frequency and acceptable staleness. Use cache invalidation on writes for critical data.",
      domain: "general", problemType: "cache_ttl", severity: "medium", confidence: 0.82,
      tags: ["cache", "ttl", "stale", "invalidation"],
    },
    {
      title: "Missing defensive coding at module boundaries",
      content: "Functions that assume valid inputs from other internal modules break when refactored or called from new contexts. Add lightweight validation at public module boundaries; trust only within the module.",
      domain: "general", problemType: "defensive_boundary", severity: "medium", confidence: 0.82,
      tags: ["defensive", "boundary", "validation", "module"],
    },
  ];
}
