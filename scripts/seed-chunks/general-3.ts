import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing audit trail for sensitive operations",
      content: "Admin actions, permission changes, and data deletions without audit logging make security incidents uninvestigable. Log: who, what, when, from where, and the before/after state for sensitive operations.",
      domain: "general", problemType: "audit_trail", severity: "high", confidence: 0.88,
      tags: ["audit", "logging", "security", "compliance"],
    },
    {
      title: "Time zone handling bugs",
      content: "Storing local times instead of UTC, ignoring DST transitions, or displaying without timezone context causes scheduling bugs. Store all timestamps in UTC, convert to local only for display.",
      domain: "general", problemType: "timezone", severity: "medium", confidence: 0.85,
      tags: ["timezone", "utc", "dst", "date"],
    },
    {
      title: "Missing data migration strategy for schema changes",
      content: "Schema changes without migration scripts cause data loss or application crashes. Write forward and backward migration scripts, test with production-like data, and run in the correct order.",
      domain: "general", problemType: "data_migration", severity: "high", confidence: 0.88,
      tags: ["migration", "schema", "data", "rollback"],
    },
    {
      title: "Unconstrained resource consumption",
      content: "Operations without resource limits (unbounded queries, unlimited file processing, no queue depth limits) can exhaust server resources. Set explicit limits on memory, time, items, and connections.",
      domain: "general", problemType: "resource_limits", severity: "high", confidence: 0.88,
      tags: ["resource", "limit", "memory", "exhaustion"],
    },
    {
      title: "Missing health check dependencies",
      content: "Health endpoints that return 200 without checking database connectivity, cache availability, or critical service reachability give false positives. Check all critical dependencies in /health.",
      domain: "general", problemType: "health_dependencies", severity: "medium", confidence: 0.85,
      tags: ["health", "dependency", "database", "cache"],
    },
    {
      title: "Semantic versioning violations",
      content: "Breaking changes in patch or minor releases violate semver and break consumer builds. Follow semver strictly: patch for bugfixes, minor for backward-compatible features, major for breaking changes.",
      domain: "general", problemType: "semver", severity: "medium", confidence: 0.82,
      tags: ["semver", "version", "breaking", "release"],
    },
    {
      title: "Missing request/response logging for debugging",
      content: "No request logging means production issues require reproduction to debug. Log request method, path, status, duration, and error details. Use correlation IDs for tracing across services.",
      domain: "general", problemType: "request_logging", severity: "medium", confidence: 0.85,
      tags: ["logging", "request", "response", "correlation"],
    },
    {
      title: "Insufficient password hashing",
      content: "Using MD5, SHA-1, or unsalted hashes for passwords is insecure. Use bcrypt, scrypt, or argon2id with work factors that take 100-500ms. Never store plaintext passwords.",
      domain: "general", problemType: "password_hashing", severity: "critical", confidence: 0.95,
      tags: ["bcrypt", "argon2", "password", "hash"],
    },
    {
      title: "Missing exponential backoff in retry logic",
      content: "Retrying failed operations immediately floods the failing service. Use exponential backoff with jitter: `delay = min(baseDelay * 2^attempt + random_jitter, maxDelay)` to spread retry load.",
      domain: "general", problemType: "backoff", severity: "medium", confidence: 0.85,
      tags: ["backoff", "exponential", "jitter", "retry"],
    },
    {
      title: "Storing sensitive data in local storage",
      content: "localStorage is accessible to any JavaScript on the page, including XSS payloads. Store tokens in httpOnly cookies. If localStorage is required, encrypt values and clear on logout.",
      domain: "general", problemType: "localstorage_secrets", severity: "high", confidence: 0.90,
      tags: ["localStorage", "xss", "token", "cookie"],
    },
    {
      title: "Missing content security policy headers",
      content: "Without CSP headers, browsers allow loading scripts from any origin, enabling XSS attacks. Set Content-Security-Policy with strict script-src, style-src, and default-src directives.",
      domain: "general", problemType: "csp", severity: "medium", confidence: 0.85,
      tags: ["csp", "security", "header", "xss"],
    },
    {
      title: "Insufficient input length validation",
      content: "Accepting arbitrarily long strings for names, descriptions, or comments can exhaust memory or database column limits. Set maximum lengths on all text inputs and validate server-side.",
      domain: "general", problemType: "length_validation", severity: "medium", confidence: 0.85,
      tags: ["length", "validation", "input", "limit"],
    },
    {
      title: "Missing database index on frequently queried columns",
      content: "Queries filtering or joining on unindexed columns perform full table scans. Add indexes to columns used in WHERE, JOIN, ORDER BY, and GROUP BY clauses. Monitor slow query logs.",
      domain: "general", problemType: "missing_index", severity: "medium", confidence: 0.88,
      tags: ["index", "database", "query", "performance"],
    },
    {
      title: "Race condition in cache invalidation",
      content: "Cache read-after-write with stale data: request 1 invalidates cache, request 2 reads DB (old data), request 1 writes DB (new data), request 2 writes cache (old data). Use write-through or cache-aside with locks.",
      domain: "general", problemType: "cache_race", severity: "medium", confidence: 0.82,
      tags: ["cache", "race", "invalidation", "stale"],
    },
    {
      title: "Missing environment-specific configuration",
      content: "Using production API keys in development or debug logging in production causes issues. Maintain separate configurations per environment (dev, staging, prod) with environment-specific defaults.",
      domain: "general", problemType: "env_config", severity: "medium", confidence: 0.85,
      tags: ["environment", "config", "production", "development"],
    },
    {
      title: "Incomplete error recovery in batch operations",
      content: "Batch operations that fail partway through leave data in inconsistent state. Use transactions for atomicity, implement compensating actions for distributed operations, or log failed items for retry.",
      domain: "general", problemType: "batch_recovery", severity: "medium", confidence: 0.85,
      tags: ["batch", "recovery", "transaction", "compensating"],
    },
    {
      title: "Missing HTTPS enforcement",
      content: "Serving content over HTTP allows man-in-the-middle attacks. Redirect HTTP to HTTPS, set HSTS headers, and use secure cookies. In development, use mkcert for local HTTPS certificates.",
      domain: "general", problemType: "https_enforcement", severity: "high", confidence: 0.90,
      tags: ["https", "hsts", "redirect", "tls"],
    },
    {
      title: "Improper error boundary placement",
      content: "A single error boundary at the app root crashes the entire UI on any error. Place error boundaries around independent sections: sidebar, main content, widgets—so failures are isolated.",
      domain: "general", problemType: "error_boundary_placement", severity: "medium", confidence: 0.85,
      tags: ["error-boundary", "granular", "isolation", "crash"],
    },
    {
      title: "Missing cleanup for temporary files",
      content: "Creating temporary files for processing without cleanup fills disk space over time. Use try/finally to delete temp files, or use a temp directory that's cleaned periodically by the OS or a cron job.",
      domain: "general", problemType: "temp_cleanup", severity: "medium", confidence: 0.85,
      tags: ["temp", "file", "cleanup", "disk"],
    },
    {
      title: "Incorrect HTTP method usage",
      content: "Using GET for mutations, POST for reads, or PUT for partial updates violates REST conventions and causes bugs with caching and browser behavior. Use correct methods: GET, POST, PUT, PATCH, DELETE.",
      domain: "general", problemType: "http_methods", severity: "low", confidence: 0.82,
      tags: ["rest", "http", "method", "convention"],
    },
    {
      title: "Missing connection pooling for database",
      content: "Creating a new database connection per request is slow and exhausts server resources. Use connection pooling with appropriate min/max pool sizes. Monitor pool utilization and wait times.",
      domain: "general", problemType: "connection_pool", severity: "medium", confidence: 0.85,
      tags: ["pool", "connection", "database", "performance"],
    },
    {
      title: "Inconsistent date formatting across application",
      content: "Dates displayed in different formats confuse users. Standardize date formatting with a utility (date-fns, dayjs) and locale-aware formatters. Use relative dates ('2 hours ago') where appropriate.",
      domain: "general", problemType: "date_formatting", severity: "low", confidence: 0.80,
      tags: ["date", "format", "locale", "consistent"],
    },
    {
      title: "Missing soft delete for recoverable data",
      content: "Hard DELETE operations are irreversible. For user-facing data, implement soft delete (isDeleted flag + deletedAt timestamp). Query active records with WHERE isDeleted = false. Purge periodically.",
      domain: "general", problemType: "soft_delete", severity: "medium", confidence: 0.82,
      tags: ["soft-delete", "recoverable", "flag", "purge"],
    },
    {
      title: "Floating point comparison for equality",
      content: "`0.1 + 0.2 === 0.3` is false in JavaScript due to IEEE 754 floating point. Use epsilon comparison: `Math.abs(a - b) < Number.EPSILON`, or integer arithmetic (cents instead of dollars).",
      domain: "general", problemType: "floating_point", severity: "medium", confidence: 0.85,
      tags: ["floating-point", "comparison", "epsilon", "money"],
    },
    {
      title: "Missing API response envelope pattern",
      content: "Returning raw data arrays makes adding metadata (pagination, status, errors) backwards-incompatible. Wrap responses: `{ data: [...], meta: { total, page }, errors: [] }` from the start.",
      domain: "general", problemType: "response_envelope", severity: "low", confidence: 0.82,
      tags: ["response", "envelope", "pagination", "metadata"],
    },
  ];
}
