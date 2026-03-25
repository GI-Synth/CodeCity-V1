import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Missing cluster mode for multi-core utilization",
      content: "Node.js runs on a single core by default. Use cluster module or PM2 cluster mode to fork workers per CPU core. For I/O-bound workloads this multiplies throughput linearly with core count.",
      domain: "nodejs", problemType: "cluster", severity: "medium", confidence: 0.82,
      tags: ["cluster", "multi-core", "pm2", "throughput"],
    },
    {
      title: "Circular dependency between modules",
      content: "Circular require/import between Node.js modules can return partially-initialized objects, causing undefined function errors. Refactor shared logic into a third module or use lazy require().",
      domain: "nodejs", problemType: "circular_dependency", severity: "medium", confidence: 0.85,
      tags: ["circular", "dependency", "require", "module"],
    },
    {
      title: "Insecure cookie configuration",
      content: "Cookies without httpOnly, secure, sameSite attributes are vulnerable to XSS and CSRF. Set httpOnly: true to prevent JS access, secure: true for HTTPS, sameSite: 'strict' or 'lax' for CSRF protection.",
      domain: "nodejs", problemType: "cookie_security", severity: "high", confidence: 0.92,
      tags: ["cookie", "httpOnly", "secure", "sameSite"],
    },
    {
      title: "Trust proxy not configured behind reverse proxy",
      content: "Express behind nginx/ALB reports 127.0.0.1 for req.ip without `app.set('trust proxy', 1)`. This breaks rate limiting, logging, and geolocation. Configure trust proxy to match your infrastructure.",
      domain: "nodejs", problemType: "trust_proxy", severity: "medium", confidence: 0.85,
      tags: ["proxy", "trust", "nginx", "ip"],
    },
    {
      title: "Missing input validation on Express routes",
      content: "Express doesn't validate request bodies, params, or query strings by default. Use Zod, Joi, or express-validator on every endpoint. Validate types, lengths, ranges, and patterns. Reject early.",
      domain: "nodejs", problemType: "input_validation", severity: "high", confidence: 0.92,
      tags: ["validation", "zod", "joi", "input"],
    },
    {
      title: "Global error handler swallowing errors",
      content: "A catch-all error handler that logs and returns 500 without details makes debugging impossible. Log the full error with stack trace server-side, return a sanitized error message to the client.",
      domain: "nodejs", problemType: "error_swallowing", severity: "medium", confidence: 0.85,
      tags: ["error", "global", "handler", "stack-trace"],
    },
    {
      title: "Using eval or new Function with dynamic input",
      content: "eval() and new Function() with user-controlled strings enable remote code execution. Never use eval with dynamic input. Use safer alternatives: JSON.parse for data, sandboxed VMs for dynamic code.",
      domain: "nodejs", problemType: "eval_danger", severity: "critical", confidence: 0.95,
      tags: ["eval", "rce", "injection", "function"],
    },
    {
      title: "Missing database query parameterization",
      content: "Building SQL with string concatenation enables SQL injection. Always use parameterized queries: `db.query('SELECT * FROM users WHERE id = ?', [id])`. ORMs like Drizzle handle this automatically.",
      domain: "nodejs", problemType: "sql_parameterization", severity: "critical", confidence: 0.95,
      tags: ["sql", "injection", "parameterized", "drizzle"],
    },
    {
      title: "Incorrect package.json engine field",
      content: "Missing or incorrect 'engines' field in package.json allows running on unsupported Node.js versions. Specify minimum version: `\"engines\": { \"node\": \">=18.0.0\" }` and use .nvmrc for team consistency.",
      domain: "nodejs", problemType: "engines_field", severity: "low", confidence: 0.82,
      tags: ["engines", "node-version", "nvmrc", "compatibility"],
    },
    {
      title: "Missing TypeScript path aliases in production",
      content: "TypeScript path aliases (@/lib) work in development with ts-node/tsx but break in production with compiled JS. Use tsconfig-paths, configure bundler aliases, or use relative imports.",
      domain: "nodejs", problemType: "path_aliases", severity: "medium", confidence: 0.85,
      tags: ["alias", "tsconfig", "paths", "production"],
    },
    {
      title: "HTTP client without retry logic",
      content: "Network requests to external APIs can fail transiently. Add retry with exponential backoff for idempotent operations (GET, PUT). Use libraries like got, ky, or undici-retry for built-in retry support.",
      domain: "nodejs", problemType: "http_retry", severity: "medium", confidence: 0.85,
      tags: ["retry", "http", "backoff", "resilience"],
    },
    {
      title: "Missing API versioning strategy",
      content: "Changing API response shapes breaks existing clients. Version APIs via URL prefix (/v1/users), header (Accept-Version), or content negotiation. Never break existing versions without deprecation period.",
      domain: "nodejs", problemType: "api_versioning", severity: "medium", confidence: 0.82,
      tags: ["versioning", "api", "backward-compatible", "deprecation"],
    },
    {
      title: "WebSocket connection without authentication",
      content: "WebSocket upgrades bypass Express middleware. Verify auth tokens in the upgrade handler or on first message. Use the ws verifyClient option to reject unauthenticated upgrade requests.",
      domain: "nodejs", problemType: "ws_auth", severity: "high", confidence: 0.90,
      tags: ["websocket", "auth", "upgrade", "verifyClient"],
    },
    {
      title: "Missing abort signal on fetch requests",
      content: "Node.js fetch without AbortSignal.timeout() can hang indefinitely on slow/unresponsive servers. Always pass an AbortSignal: `fetch(url, { signal: AbortSignal.timeout(5000) })`.",
      domain: "nodejs", problemType: "fetch_timeout", severity: "medium", confidence: 0.88,
      tags: ["fetch", "abort", "timeout", "signal"],
    },
    {
      title: "Inadequate error messages for debugging",
      content: "Throwing `new Error('failed')` without context makes debugging impossible. Include operation, entity, and cause: `new Error('Failed to fetch user 123', { cause: originalError })`.",
      domain: "nodejs", problemType: "error_context", severity: "medium", confidence: 0.85,
      tags: ["error", "message", "context", "cause"],
    },
    {
      title: "Worker threads misuse for I/O-bound tasks",
      content: "Worker threads add overhead and are designed for CPU-intensive tasks. For I/O-bound work (database queries, HTTP requests), use async/await with the event loop. Workers help for crypto, parsing, compression.",
      domain: "nodejs", problemType: "worker_misuse", severity: "low", confidence: 0.82,
      tags: ["worker", "thread", "cpu", "io"],
    },
    {
      title: "Missing idempotency keys for mutation endpoints",
      content: "Network retries on POST/PUT without idempotency can create duplicate records. Accept an Idempotency-Key header, store it with results, and return cached result on duplicate requests.",
      domain: "nodejs", problemType: "idempotency", severity: "medium", confidence: 0.82,
      tags: ["idempotency", "retry", "duplicate", "key"],
    },
    {
      title: "Insufficient process monitoring",
      content: "No visibility into memory usage, event loop lag, or request latency means issues are discovered in production outages. Add prom-client metrics, expose /metrics endpoint, connect to Grafana/Datadog.",
      domain: "nodejs", problemType: "monitoring", severity: "medium", confidence: 0.85,
      tags: ["monitoring", "prometheus", "metrics", "grafana"],
    },
    {
      title: "Missing content-type validation on incoming requests",
      content: "Not checking Content-Type header means your JSON parser may receive XML, form data, or binary. Validate Content-Type matches expected format and reject with 415 Unsupported Media Type.",
      domain: "nodejs", problemType: "content_type", severity: "low", confidence: 0.82,
      tags: ["content-type", "415", "validation", "header"],
    },
    {
      title: "Hard-coded secrets in source code",
      content: "API keys, database passwords, and tokens committed to source code are exposed in version control. Use environment variables, .env files (in .gitignore), or a secrets manager for all credentials.",
      domain: "nodejs", problemType: "hardcoded_secrets", severity: "critical", confidence: 0.95,
      tags: ["secrets", "env", "api-key", "git"],
    },
    {
      title: "Missing request ID for tracing",
      content: "Without a unique request ID, correlating logs across services is impossible. Add middleware that generates or propagates X-Request-Id header and includes it in all log entries for that request.",
      domain: "nodejs", problemType: "request_id", severity: "medium", confidence: 0.85,
      tags: ["request-id", "tracing", "correlation", "logging"],
    },
    {
      title: "Incorrect handling of multipart form data",
      content: "Using express.json() doesn't parse multipart/form-data uploads. Use multer middleware for file uploads with proper limits on file size, count, and allowed MIME types to prevent abuse.",
      domain: "nodejs", problemType: "multipart", severity: "medium", confidence: 0.85,
      tags: ["multipart", "multer", "upload", "form-data"],
    },
    {
      title: "Missing database transaction for multi-step operations",
      content: "Multiple related database writes without a transaction can leave data in an inconsistent state if one fails. Wrap create-user + create-profile type operations in a single transaction.",
      domain: "nodejs", problemType: "transaction_missing", severity: "high", confidence: 0.90,
      tags: ["transaction", "database", "consistency", "atomic"],
    },
    {
      title: "Package.json scripts missing cross-platform compatibility",
      content: "Shell-specific syntax in npm scripts (&&, rm -rf, unix paths) breaks on Windows. Use cross-env, rimraf, and slash paths for cross-platform scripts. Test CI on multiple OS when applicable.",
      domain: "nodejs", problemType: "cross_platform", severity: "low", confidence: 0.80,
      tags: ["cross-platform", "scripts", "windows", "cross-env"],
    },
    {
      title: "Excessive npm dependencies for simple tasks",
      content: "Installing heavy packages for simple operations (left-pad, is-even) adds supply chain risk and bundle size. Implement trivial utilities inline. Audit dependencies with npm audit regularly.",
      domain: "nodejs", problemType: "dependency_bloat", severity: "low", confidence: 0.82,
      tags: ["dependency", "bloat", "audit", "supply-chain"],
    },
  ];
}
