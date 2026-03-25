import type { SeedEntry } from "../seed-knowledge-v2";

export function getEntries(): SeedEntry[] {
  return [
    {
      title: "Unvalidated file uploads",
      content: "Accepting file uploads without validating type, size, and content enables malware upload, path traversal, and storage exhaustion. Validate MIME type, file extension, max size, and scan content. Store outside webroot with random names.",
      domain: "security", problemType: "file_upload", severity: "high", confidence: 0.90,
      tags: ["upload", "file", "validation", "malware"],
    },
    {
      title: "Mass assignment vulnerability",
      content: "Passing entire request body to database update/create allows attackers to set fields they shouldn't (isAdmin, role). Whitelist allowed fields explicitly. Example bad: `User.update(req.body)`. Fix: `User.update({ name: req.body.name, email: req.body.email })`.",
      domain: "security", problemType: "mass_assignment", severity: "high", confidence: 0.90,
      tags: ["mass-assignment", "whitelist", "model", "update"],
    },
    {
      title: "Timing attack on string comparison",
      content: "Using === to compare secrets (tokens, passwords) leaks info via response time differences. Use crypto.timingSafeEqual() for constant-time comparison of sensitive values.",
      domain: "security", problemType: "timing_attack", severity: "medium", confidence: 0.85,
      tags: ["timing", "comparison", "crypto", "constant-time"],
    },
    {
      title: "Exposed GraphQL introspection in production",
      content: "GraphQL introspection reveals your entire schema including internal types and mutations. Disable introspection in production: `{ introspection: process.env.NODE_ENV !== 'production' }`.",
      domain: "security", problemType: "information_disclosure", severity: "medium", confidence: 0.88,
      tags: ["graphql", "introspection", "schema", "production"],
    },
    {
      title: "Missing CSRF protection on state-changing requests",
      content: "Without CSRF tokens, attackers can trick authenticated users into making unwanted requests. Implement CSRF tokens for all POST/PUT/DELETE requests, or use SameSite=Strict cookies and verify Origin/Referer headers.",
      domain: "security", problemType: "csrf", severity: "high", confidence: 0.90,
      tags: ["csrf", "token", "state-change", "cookies"],
    },
    {
      title: "Logging sensitive data",
      content: "Logging passwords, tokens, credit card numbers, or PII creates compliance risks and breach vectors. Sanitize logs by redacting sensitive fields. Use structured logging with explicit field selection, never log full request bodies.",
      domain: "security", problemType: "data_exposure", severity: "high", confidence: 0.88,
      tags: ["logging", "sensitive-data", "pii", "redaction"],
    },
    {
      title: "Insecure random number generation",
      content: "Using Math.random() for security-sensitive values (tokens, IDs, nonces) is predictable. Use crypto.randomBytes() or crypto.randomUUID() for cryptographically secure random values.",
      domain: "security", problemType: "weak_crypto", severity: "high", confidence: 0.92,
      tags: ["random", "crypto", "token", "uuid"],
    },
    {
      title: "Command injection via child_process",
      content: "Passing user input to exec() or spawn() shell commands enables OS command injection. Use execFile() with argument arrays instead of exec() with string interpolation. Never pass user input to shell commands without strict validation.",
      domain: "security", problemType: "command_injection", severity: "critical", confidence: 0.95,
      tags: ["command", "injection", "exec", "child-process"],
    },
    {
      title: "Exposed debug endpoints in production",
      content: "Debug routes (/debug, /admin/internal, /api/test) left active in production expose internal state. Gate debug endpoints behind environment checks and authentication: `if (process.env.NODE_ENV === 'development')`.",
      domain: "security", problemType: "debug_exposure", severity: "high", confidence: 0.88,
      tags: ["debug", "production", "endpoint", "environment"],
    },
    {
      title: "Insufficient password policy",
      content: "Accepting weak passwords compromises accounts. Enforce minimum 8 characters, reject common passwords (check against haveibeenpwned list or top-10000 list), and encourage passphrase usage over complexity rules.",
      domain: "security", problemType: "weak_password", severity: "medium", confidence: 0.85,
      tags: ["password", "policy", "strength", "authentication"],
    },
    {
      title: "Missing token expiration on JWT",
      content: "JWTs without expiration (exp claim) remain valid indefinitely. Always set short expiration times (15-60 minutes for access tokens), use refresh tokens for longer sessions, and implement token revocation.",
      domain: "security", problemType: "token_expiry", severity: "high", confidence: 0.90,
      tags: ["jwt", "expiration", "token", "refresh"],
    },
    {
      title: "Exposing internal error details to clients",
      content: "Sending full error objects to API responses reveals internal paths, query structure, and dependencies. Catch errors at the boundary and return sanitized messages. Log details server-side only.",
      domain: "security", problemType: "information_disclosure", severity: "medium", confidence: 0.88,
      tags: ["error", "disclosure", "sanitize", "api"],
    },
    {
      title: "Missing account lockout after failed attempts",
      content: "Without account lockout, attackers can endlessly attempt passwords. Implement progressive delays or temporary lockouts after 5-10 failed attempts. Use exponential backoff and notify account owners.",
      domain: "security", problemType: "brute_force", severity: "medium", confidence: 0.85,
      tags: ["lockout", "brute-force", "attempts", "delay"],
    },
    {
      title: "Storing passwords in plain text",
      content: "Plain text password storage in database means any breach exposes all credentials. Hash passwords with bcrypt (cost factor 12+), scrypt, or argon2 before storage. Never store or log raw passwords.",
      domain: "security", problemType: "plaintext_password", severity: "critical", confidence: 0.98,
      tags: ["password", "plaintext", "bcrypt", "hashing"],
    },
    {
      title: "XML External Entity (XXE) injection",
      content: "Parsing XML with external entity resolution enabled allows file reads and SSRF. Disable DTD processing and external entities in XML parsers. Use JSON instead of XML where possible.",
      domain: "security", problemType: "xxe", severity: "critical", confidence: 0.88,
      tags: ["xml", "xxe", "entity", "parser"],
    },
    {
      title: "Broken access control on API routes",
      content: "Checking authentication but not authorization allows authenticated users to access other users' data. Implement role-based access control (RBAC) and verify resource ownership on every request. Test with different user roles.",
      domain: "security", problemType: "broken_access", severity: "critical", confidence: 0.92,
      tags: ["access-control", "authorization", "rbac", "ownership"],
    },
    {
      title: "Server-side template injection",
      content: "Passing user input directly into template engine expressions (EJS, Pug, Handlebars) allows code execution. Never interpolate user input into template strings. Use template engine autoescape and validate all dynamic content.",
      domain: "security", problemType: "template_injection", severity: "critical", confidence: 0.88,
      tags: ["template", "injection", "ssti", "ejs"],
    },
    {
      title: "Missing subresource integrity (SRI) on CDN scripts",
      content: "Loading scripts from CDNs without integrity attributes means a compromised CDN can inject malicious code. Add integrity and crossorigin attributes to all external script/link tags.",
      domain: "security", problemType: "supply_chain", severity: "medium", confidence: 0.85,
      tags: ["sri", "cdn", "integrity", "supply-chain"],
    },
    {
      title: "Permissive CORS with credentials",
      content: "Setting Access-Control-Allow-Origin: * with credentials: true is invalid but signals intent to be permissive. Dynamically set Origin from allowlist, never reflect arbitrary Origin headers with credentials.",
      domain: "security", problemType: "cors_misconfiguration", severity: "high", confidence: 0.90,
      tags: ["cors", "credentials", "origin", "wildcard"],
    },
    {
      title: "Unencrypted data at rest",
      content: "Storing sensitive data (PII, credentials, health records) unencrypted in databases violates compliance requirements. Encrypt sensitive columns with AES-256-GCM, manage keys with a KMS, and use encrypted database connections.",
      domain: "security", problemType: "encryption_at_rest", severity: "high", confidence: 0.85,
      tags: ["encryption", "data-at-rest", "aes", "compliance"],
    },
    {
      title: "Improper error handling revealing technology stack",
      content: "Default error pages from Express, Koa, or other frameworks reveal framework name and version. Use custom error handlers that return generic JSON errors. Remove X-Powered-By header: `app.disable('x-powered-by')`.",
      domain: "security", problemType: "information_disclosure", severity: "low", confidence: 0.90,
      tags: ["error-page", "fingerprint", "x-powered-by", "framework"],
    },
    {
      title: "Using deprecated or vulnerable dependencies",
      content: "Outdated packages contain known vulnerabilities. Run `npm audit` or `pnpm audit` regularly. Set up automated dependency updates with Dependabot or Renovate. Pin major versions and review changelogs.",
      domain: "security", problemType: "vulnerable_deps", severity: "high", confidence: 0.90,
      tags: ["dependencies", "audit", "npm", "vulnerability"],
    },
    {
      title: "DNS rebinding attack surface",
      content: "Local development servers binding to 0.0.0.0 without host validation are vulnerable to DNS rebinding. Validate the Host header against expected values, especially for APIs that perform privileged operations.",
      domain: "security", problemType: "dns_rebinding", severity: "medium", confidence: 0.82,
      tags: ["dns", "rebinding", "host-header", "localhost"],
    },
    {
      title: "Insufficient logging of security events",
      content: "Not logging authentication failures, access denied events, and admin actions makes incident response impossible. Log all auth events, rate limit violations, and privilege changes with timestamps, IP, and user ID.",
      domain: "security", problemType: "insufficient_logging", severity: "medium", confidence: 0.88,
      tags: ["logging", "audit", "security-events", "monitoring"],
    },
    {
      title: "Unsafe use of dangerouslySetInnerHTML in React",
      content: "React's dangerouslySetInnerHTML bypasses XSS protection. Sanitize all HTML with DOMPurify before using it. If possible, use Markdown-to-React libraries that parse safely instead of injecting raw HTML.",
      domain: "security", problemType: "xss", severity: "high", confidence: 0.92,
      tags: ["react", "dangerouslySetInnerHTML", "xss", "dompurify"],
    },
  ];
}
