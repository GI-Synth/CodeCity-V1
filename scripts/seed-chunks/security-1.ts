import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "SQL injection via string concatenation",
      content: "Building SQL queries by concatenating user input directly creates injection vulnerabilities. Use parameterized queries or prepared statements instead. Example bad: `db.query('SELECT * FROM users WHERE id = ' + userId)`. Fix: `db.query('SELECT * FROM users WHERE id = ?', [userId])`.",
      domain: "security", problemType: "sql_injection", severity: "critical", confidence: 0.95,
      tags: ["sql", "injection", "parameterized", "query"],
    },
    {
      title: "NoSQL injection in MongoDB queries",
      content: "Passing user input directly into MongoDB query operators like $gt, $ne, $where allows NoSQL injection. Validate and sanitize all inputs before using them in queries. Example bad: `db.find({ user: req.body.user })` when body contains `{\"user\": {\"$ne\": \"\"}}`. Fix: validate that user is a string type.",
      domain: "security", problemType: "nosql_injection", severity: "critical", confidence: 0.95,
      tags: ["mongodb", "nosql", "injection", "validation"],
    },
    {
      title: "Hardcoded API keys and secrets in source code",
      content: "API keys, passwords, and tokens committed to source code can be extracted by anyone with repo access. Move secrets to environment variables and use .env files excluded from version control. Scan with tools like trufflehog or gitleaks.",
      domain: "security", problemType: "hardcoded_secret", severity: "critical", confidence: 0.98,
      tags: ["secrets", "api-key", "environment", "credential"],
    },
    {
      title: "JWT secret stored in source code",
      content: "JWT signing secrets in source code allow anyone to forge valid tokens. Store JWT_SECRET in environment variables, rotate regularly, and use asymmetric keys (RS256) for production. Example bad: `jwt.sign(payload, 'my-secret')`. Fix: `jwt.sign(payload, process.env.JWT_SECRET)`.",
      domain: "security", problemType: "hardcoded_secret", severity: "critical", confidence: 0.95,
      tags: ["jwt", "secret", "token", "authentication"],
    },
    {
      title: "Missing input validation on user-supplied data",
      content: "Accepting user input without validation allows injection, type confusion, and logic errors. Validate all request parameters with a schema library like Zod or Joi at the API boundary. Check type, length, format, and range.",
      domain: "security", problemType: "missing_validation", severity: "high", confidence: 0.92,
      tags: ["validation", "input", "zod", "sanitization"],
    },
    {
      title: "Prototype pollution vulnerability",
      content: "Merging user-controlled objects into application objects can pollute Object.prototype. Use Object.create(null) for lookup maps, validate keys against __proto__ and constructor, or use Map instead of plain objects. Libraries like lodash.merge are vulnerable in older versions.",
      domain: "security", problemType: "prototype_pollution", severity: "high", confidence: 0.90,
      tags: ["prototype", "pollution", "merge", "object"],
    },
    {
      title: "Path traversal via user-controlled file paths",
      content: "Using user input to construct file paths without sanitization allows reading arbitrary files. Example bad: `fs.readFile('/uploads/' + req.params.file)` with input `../../etc/passwd`. Fix: use path.resolve and verify the resolved path stays within the allowed directory.",
      domain: "security", problemType: "path_traversal", severity: "critical", confidence: 0.95,
      tags: ["path", "traversal", "directory", "file-access"],
    },
    {
      title: "SSRF via user-controlled URLs",
      content: "Fetching URLs provided by users without validation enables Server-Side Request Forgery. Attackers can access internal services (169.254.169.254 for cloud metadata). Validate URL scheme (https only), block private IP ranges, and use allowlists for domains.",
      domain: "security", problemType: "ssrf", severity: "critical", confidence: 0.93,
      tags: ["ssrf", "fetch", "url", "internal"],
    },
    {
      title: "Missing rate limiting on authentication endpoints",
      content: "Authentication endpoints without rate limiting are vulnerable to brute force attacks. Apply rate limiting (e.g., express-rate-limit) with stricter limits on /login, /register, /reset-password. Example: max 5 attempts per IP per 15 minutes.",
      domain: "security", problemType: "missing_rate_limit", severity: "high", confidence: 0.90,
      tags: ["rate-limit", "brute-force", "authentication", "dos"],
    },
    {
      title: "Insecure direct object reference (IDOR)",
      content: "Exposing database IDs in URLs without authorization checks allows users to access other users' data. Example: GET /api/users/123/documents. Fix: verify the authenticated user has permission to access the requested resource before returning data.",
      domain: "security", problemType: "idor", severity: "high", confidence: 0.92,
      tags: ["idor", "authorization", "access-control", "object-reference"],
    },
    {
      title: "Missing CORS configuration",
      content: "Missing or overly permissive CORS headers allow any website to make authenticated requests to your API. Configure Access-Control-Allow-Origin to specific trusted domains, not '*' when credentials are used. Review CORS for every route that handles sensitive data.",
      domain: "security", problemType: "cors_misconfiguration", severity: "high", confidence: 0.88,
      tags: ["cors", "origin", "cross-site", "headers"],
    },
    {
      title: "eval() with user input",
      content: "Using eval(), new Function(), or setTimeout with string arguments on user-controlled data enables arbitrary code execution. Never eval user input. Use JSON.parse for data, safe expression evaluators, or sandboxed environments.",
      domain: "security", problemType: "code_injection", severity: "critical", confidence: 0.98,
      tags: ["eval", "code-injection", "rce", "function"],
    },
    {
      title: "Unsafe deserialization of untrusted data",
      content: "Deserializing untrusted data (e.g., YAML.load, pickle, Java ObjectInputStream) can execute arbitrary code. Use safe deserialization methods (YAML.safeLoad, JSON.parse) and validate the structure of deserialized data with schemas.",
      domain: "security", problemType: "deserialization", severity: "critical", confidence: 0.90,
      tags: ["deserialization", "yaml", "json", "rce"],
    },
    {
      title: "XSS via innerHTML assignment",
      content: "Setting innerHTML with user-controlled content enables cross-site scripting. Use textContent for plain text, or sanitize HTML with DOMPurify before inserting. In React, avoid dangerouslySetInnerHTML with unsanitized data.",
      domain: "security", problemType: "xss", severity: "critical", confidence: 0.95,
      tags: ["xss", "innerHTML", "sanitization", "dom"],
    },
    {
      title: "Missing HTTPS enforcement",
      content: "Serving content over HTTP exposes data to man-in-the-middle attacks. Enforce HTTPS with HSTS headers (Strict-Transport-Security), redirect HTTP to HTTPS, and set secure flag on cookies.",
      domain: "security", problemType: "transport_security", severity: "high", confidence: 0.92,
      tags: ["https", "hsts", "tls", "transport"],
    },
    {
      title: "Weak cryptography: MD5 or SHA1 for passwords",
      content: "MD5 and SHA1 are fast hashes not designed for passwords — they're vulnerable to rainbow table and brute force attacks. Use bcrypt, scrypt, or argon2 with proper salt and work factors. Example: `await bcrypt.hash(password, 12)`.",
      domain: "security", problemType: "weak_crypto", severity: "critical", confidence: 0.95,
      tags: ["crypto", "password", "bcrypt", "hashing"],
    },
    {
      title: "Missing authentication on sensitive routes",
      content: "Routes that modify data or return sensitive information must require authentication. Apply auth middleware to all non-public routes. Audit route files to ensure no sensitive endpoints are exposed without authentication checks.",
      domain: "security", problemType: "missing_auth", severity: "critical", confidence: 0.93,
      tags: ["authentication", "middleware", "routes", "access"],
    },
    {
      title: "Session fixation vulnerability",
      content: "Not regenerating session IDs after login allows attackers to fix a known session ID. Always call req.session.regenerate() after successful authentication. Invalidate old sessions on logout.",
      domain: "security", problemType: "session_fixation", severity: "high", confidence: 0.88,
      tags: ["session", "fixation", "authentication", "regenerate"],
    },
    {
      title: "Clickjacking via missing X-Frame-Options",
      content: "Without X-Frame-Options or Content-Security-Policy frame-ancestors, pages can be embedded in iframes for clickjacking attacks. Set header: `X-Frame-Options: DENY` or use `Content-Security-Policy: frame-ancestors 'none'`.",
      domain: "security", problemType: "clickjacking", severity: "medium", confidence: 0.90,
      tags: ["clickjacking", "iframe", "headers", "csp"],
    },
    {
      title: "Open redirect vulnerability",
      content: "Redirecting users to a URL from query parameters without validation enables phishing. Example bad: `res.redirect(req.query.next)`. Fix: validate the redirect URL is a relative path or matches an allowlist of trusted domains.",
      domain: "security", problemType: "open_redirect", severity: "medium", confidence: 0.88,
      tags: ["redirect", "phishing", "url", "validation"],
    },
    {
      title: "Missing Content-Security-Policy header",
      content: "Without CSP, browsers execute any inline script or load resources from any origin, enabling XSS. Set CSP headers to restrict script sources: `Content-Security-Policy: default-src 'self'; script-src 'self'`. Use nonces for inline scripts.",
      domain: "security", problemType: "missing_csp", severity: "high", confidence: 0.88,
      tags: ["csp", "headers", "xss", "inline-script"],
    },
    {
      title: "Sensitive data in error messages",
      content: "Exposing stack traces, database queries, or internal paths in error responses leaks implementation details. Return generic error messages (\"Something went wrong\") to clients and log detailed errors server-side only.",
      domain: "security", problemType: "information_disclosure", severity: "medium", confidence: 0.90,
      tags: ["error-handling", "information-disclosure", "stack-trace", "logging"],
    },
    {
      title: "Missing HTTP security headers",
      content: "Missing headers like X-Content-Type-Options, X-XSS-Protection, Referrer-Policy expose the app to various attacks. Use helmet middleware for Express to set all security headers at once: `app.use(helmet())`.",
      domain: "security", problemType: "missing_headers", severity: "medium", confidence: 0.88,
      tags: ["headers", "helmet", "x-content-type", "referrer-policy"],
    },
    {
      title: "Insecure cookie flags",
      content: "Cookies without Secure, HttpOnly, and SameSite flags are vulnerable to theft and CSRF. Set: `{ httpOnly: true, secure: true, sameSite: 'strict' }` on all authentication cookies.",
      domain: "security", problemType: "insecure_cookies", severity: "high", confidence: 0.92,
      tags: ["cookies", "httponly", "secure", "samesite"],
    },
    {
      title: "Regex denial of service (ReDoS)",
      content: "Complex regex patterns with nested quantifiers can cause catastrophic backtracking on malicious input, hanging the server. Example bad: `/^(a+)+$/`. Use linear-time regex engines, add input length limits, or use re2 library for untrusted input.",
      domain: "security", problemType: "redos", severity: "high", confidence: 0.85,
      tags: ["regex", "redos", "dos", "backtracking"],
    },
  ];
}
