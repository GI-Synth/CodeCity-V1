import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Unhandled promise rejection crashing process",
      content: "Node.js terminates on unhandled promise rejections by default. Add `process.on('unhandledRejection', handler)` and always .catch() or await with try/catch. Set --unhandled-rejections=throw explicitly.",
      domain: "nodejs", problemType: "unhandled_rejection", severity: "critical", confidence: 0.95,
      tags: ["promise", "rejection", "crash", "process"],
    },
    {
      title: "Blocking the event loop with synchronous operations",
      content: "fs.readFileSync, JSON.parse on huge strings, or crypto operations block the event loop, freezing all requests. Use async alternatives: fs.readFile, streaming JSON parsers, or worker threads for CPU work.",
      domain: "nodejs", problemType: "event_loop_blocking", severity: "high", confidence: 0.92,
      tags: ["event-loop", "blocking", "sync", "async"],
    },
    {
      title: "Missing graceful shutdown handler",
      content: "Not handling SIGTERM/SIGINT means in-flight requests are dropped, database connections leak, and data can be corrupted. Listen for signals, stop accepting new connections, drain existing ones, then exit.",
      domain: "nodejs", problemType: "graceful_shutdown", severity: "high", confidence: 0.90,
      tags: ["shutdown", "SIGTERM", "drain", "cleanup"],
    },
    {
      title: "Environment variable without validation",
      content: "Reading process.env.PORT without validation can yield undefined, empty string, or non-numeric values. Validate all env vars at startup with zod, envalid, or manual checks. Fail fast on missing required vars.",
      domain: "nodejs", problemType: "env_validation", severity: "medium", confidence: 0.88,
      tags: ["env", "validation", "zod", "startup"],
    },
    {
      title: "Memory leak from growing arrays or caches",
      content: "In-memory caches, arrays, or Maps that grow unbounded over server lifetime cause OOM crashes. Set max sizes, use LRU caches (lru-cache package), or use external stores (Redis) for long-lived data.",
      domain: "nodejs", problemType: "memory_leak", severity: "high", confidence: 0.90,
      tags: ["memory", "leak", "cache", "lru"],
    },
    {
      title: "Missing request timeout on HTTP server",
      content: "Without request timeouts, slow clients or hanging requests consume server resources indefinitely. Set server.timeout, server.requestTimeout, and use AbortSignal with timeout for outgoing requests.",
      domain: "nodejs", problemType: "request_timeout", severity: "medium", confidence: 0.88,
      tags: ["timeout", "request", "slow-client", "resource"],
    },
    {
      title: "Spawning child processes without input sanitization",
      content: "Using exec() or execSync() with user input enables command injection. Use execFile() or spawn() with argument arrays (no shell interpolation). Never pass unsanitized strings to shell commands.",
      domain: "nodejs", problemType: "command_injection", severity: "critical", confidence: 0.95,
      tags: ["exec", "injection", "spawn", "sanitize"],
    },
    {
      title: "Synchronous file operations in request handlers",
      content: "Using fs.existsSync, fs.readFileSync in Express/Fastify handlers blocks the event loop for every request. Use async fs.promises.readFile or streaming APIs for all file operations in handlers.",
      domain: "nodejs", problemType: "sync_in_handler", severity: "high", confidence: 0.92,
      tags: ["sync", "fs", "handler", "blocking"],
    },
    {
      title: "Missing rate limiting on API endpoints",
      content: "APIs without rate limiting are vulnerable to abuse, DDoS, and resource exhaustion. Add rate limiting (express-rate-limit) per IP or API key. Use sliding window or token bucket algorithms.",
      domain: "nodejs", problemType: "rate_limiting", severity: "high", confidence: 0.90,
      tags: ["rate-limit", "ddos", "express", "throttle"],
    },
    {
      title: "Incorrect error handling middleware order",
      content: "Express error handlers must have 4 parameters (err, req, res, next) and be registered LAST. Placing them before routes or missing the err parameter makes them act as regular middleware.",
      domain: "nodejs", problemType: "error_middleware", severity: "medium", confidence: 0.88,
      tags: ["express", "error", "middleware", "order"],
    },
    {
      title: "Stream backpressure not handled",
      content: "Piping fast-producing readable streams to slow-consuming writable streams without respecting backpressure causes unbounded memory growth. Use pipeline() from stream/promises or check .write() return value.",
      domain: "nodejs", problemType: "backpressure", severity: "medium", confidence: 0.85,
      tags: ["stream", "backpressure", "pipeline", "memory"],
    },
    {
      title: "Using deprecated Node.js APIs",
      content: "url.parse(), domain module, new Buffer(), and util.pump are deprecated and may be removed. Use new URL(), try/catch, Buffer.from()/Buffer.alloc(), and stream.pipeline() respectively.",
      domain: "nodejs", problemType: "deprecated_api", severity: "low", confidence: 0.85,
      tags: ["deprecated", "url", "buffer", "migration"],
    },
    {
      title: "Missing CORS configuration",
      content: "APIs without proper CORS headers block browser requests from other origins. Use the cors middleware with specific allowlist of origins. Never use `origin: '*'` with credentials in production.",
      domain: "nodejs", problemType: "cors", severity: "medium", confidence: 0.88,
      tags: ["cors", "origin", "credentials", "browser"],
    },
    {
      title: "Database connection pool exhaustion",
      content: "Not returning database connections to the pool (forgotten .release() or unclosed transactions) exhausts the pool, hanging all queries. Use try/finally patterns and monitor pool statistics.",
      domain: "nodejs", problemType: "connection_pool", severity: "high", confidence: 0.90,
      tags: ["database", "connection", "pool", "deadlock"],
    },
    {
      title: "Missing health check endpoint",
      content: "Load balancers and orchestrators need a health check endpoint to route traffic. Add GET /health that verifies database connectivity, external service reachability, and returns 200 or 503.",
      domain: "nodejs", problemType: "health_check", severity: "medium", confidence: 0.85,
      tags: ["health", "endpoint", "kubernetes", "load-balancer"],
    },
    {
      title: "Logging sensitive data in production",
      content: "Logging req.body, authorization headers, passwords, or tokens exposes secrets in log files. Redact sensitive fields, use structured logging (pino, winston), and configure log levels per environment.",
      domain: "nodejs", problemType: "sensitive_logging", severity: "high", confidence: 0.90,
      tags: ["logging", "sensitive", "redact", "password"],
    },
    {
      title: "Missing helmet security headers",
      content: "Express apps without security headers (X-Frame-Options, CSP, HSTS) are vulnerable to clickjacking and XSS. Use helmet middleware which sets sensible security headers by default.",
      domain: "nodejs", problemType: "security_headers", severity: "medium", confidence: 0.88,
      tags: ["helmet", "headers", "security", "csp"],
    },
    {
      title: "File path traversal vulnerability",
      content: "Constructing file paths from user input without validation allows reading arbitrary files: `../../etc/passwd`. Use path.resolve then verify the result is within the allowed directory (startsWith check).",
      domain: "nodejs", problemType: "path_traversal", severity: "critical", confidence: 0.95,
      tags: ["path", "traversal", "directory", "security"],
    },
    {
      title: "Missing request body size limit",
      content: "Without body size limits, attackers can send huge payloads causing OOM. Set express.json({ limit: '1mb' }) and configure multer limits for file uploads. Apply limits before processing.",
      domain: "nodejs", problemType: "body_limit", severity: "medium", confidence: 0.88,
      tags: ["body", "limit", "payload", "oom"],
    },
    {
      title: "Incorrect async error propagation in Express 4",
      content: "Express 4 doesn't catch async errors from route handlers. Either wrap handlers with asyncHandler() that calls next(err), upgrade to Express 5 which handles async natively, or use express-async-errors.",
      domain: "nodejs", problemType: "async_express", severity: "high", confidence: 0.90,
      tags: ["async", "express", "error", "next"],
    },
    {
      title: "Missing process manager for production",
      content: "Running `node app.js` directly in production means crashes kill the service. Use PM2, systemd, or container orchestration (Docker + K8s) to auto-restart on crash and manage multiple instances.",
      domain: "nodejs", problemType: "process_manager", severity: "medium", confidence: 0.85,
      tags: ["pm2", "production", "restart", "container"],
    },
    {
      title: "DNS lookup caching issues with keep-alive",
      content: "Node.js DNS lookups aren't cached by default with keep-alive agents. Services behind load balancers with changing IPs can route to stale hosts. Use undici with DNS caching or configure lookup caching.",
      domain: "nodejs", problemType: "dns_caching", severity: "low", confidence: 0.80,
      tags: ["dns", "cache", "keep-alive", "undici"],
    },
    {
      title: "Missing structured logging format",
      content: "console.log with string concatenation creates unstructured logs that are hard to search and parse. Use pino or winston with JSON output format for machine-parseable, queryable log entries.",
      domain: "nodejs", problemType: "structured_logging", severity: "medium", confidence: 0.85,
      tags: ["logging", "pino", "json", "structured"],
    },
    {
      title: "Event emitter memory leak warning",
      content: "Adding listeners without removing them triggers 'MaxListenersExceededWarning'. Call removeListener/off in cleanup. If more legitimate listeners are needed, set emitter.setMaxListeners(n) explicitly.",
      domain: "nodejs", problemType: "event_emitter_leak", severity: "medium", confidence: 0.85,
      tags: ["event-emitter", "listener", "leak", "warning"],
    },
    {
      title: "Missing compression middleware",
      content: "Sending uncompressed JSON responses wastes bandwidth. Add compression middleware (compression or zlib) for Express. Configure minimum size threshold and exclude already-compressed formats.",
      domain: "nodejs", problemType: "compression", severity: "low", confidence: 0.82,
      tags: ["compression", "gzip", "bandwidth", "middleware"],
    },
  ];
}
