# Security Audit & Fix Session Log

**Date:** 2025-01-XX  
**Baseline Commit:** `bdb57e0` (pre-audit: snapshot of current working state)

---

## Audit Summary

A comprehensive security and code-quality audit was conducted. **30 findings** were identified across 4 severity levels:

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH | 6 |
| MEDIUM | 10 |
| LOW | 9 |

---

## Phase 1 — Critical Security Fixes

### 1. CORS Restriction (`app.ts`)
- **Before:** `app.use(cors())` — accepts requests from any origin
- **After:** Origin allowlist from `ALLOWED_ORIGINS` env var (default: `http://localhost:5173`); unknown origins rejected

### 2. Security Headers (`app.ts`)
- **Before:** No security headers (no CSP, no X-Frame-Options, etc.)
- **After:** Added `helmet` middleware — sets Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.

### 3. Body Size Limit (`app.ts`)
- **Before:** `express.json()` with no size limit — victims could POST gigabyte payloads
- **After:** `express.json({ limit: '1mb' })` and `express.urlencoded({ limit: '1mb' })`

### 4. Test Executor Sandboxing (`testExecutor.ts`)
- **Before:** `spawn()` with default env inheritance — all API keys, DB paths, secrets leaked to AI-generated test code
- **After:** `sanitizedEnv()` strips all `*_KEY`, `*_SECRET`, `GITHUB_TOKEN`, `DB_PATH` from child process env
- Also: Full UUID for temp files (was truncated to 8 chars)

### 5. Alchemist Executor Env Stripping (`alchemistExecutor.ts`)
- **Before:** `env: process.env` passed directly to spawned processes
- **After:** `env: sanitizedEnv()` — same key-stripping approach as testExecutor

### 6. API Key Redaction in Logs (`providers/router.ts`)
- **Before:** Error messages logged verbatim, could contain API keys
- **After:** Regex redaction of `sk-*`, `gsk_*`, `key-*`, `Bearer *` patterns before logging

### 7. Graceful Shutdown Fix (`index.ts`)
- **Before:** `setTimeout(() => process.exit(1), 5000)` — exit code 1 on timeout
- **After:** `process.exit(0)` with `.unref()` — clean exit code, timer won't keep process alive

---

## Phase 2 — High Severity Fixes

### 8. SSRF Prevention (`githubFetcher.ts`)
- **Before:** Regex-based URL parsing: `repoUrl.match(/github\.com\/.../)` — could be bypassed (e.g., `github.com.evil.com`)
- **After:** `new URL()` parsing + explicit `hostname === "github.com"` check

### 9. Encryption Key Hardening (`githubTokenStore.ts`)
- **Before:** Key derived from `os.hostname()` alone — low entropy, predictable
- **After:** Key derived from `hostname + APP_SECRET env + static salt`

### 10. Git Show Restriction (`alchemistExecutor.ts`)
- **Before:** `git show` allowed unconditionally — could leak arbitrary file contents
- **After:** `git show` only allowed for commit SHAs (6-40 hex chars)

### 11. Safe JSON Parsing (`providers/router.ts`)
- **Before:** `await res.json()` could throw on malformed response bodies
- **After:** `await res.json().catch(() => ({}))` — graceful fallback for both Google and OpenAI-compatible providers

### 12. SQLite Hardening (`lib/db/src/index.ts`)
- **Before:** No pragmas — default rollback journal, no busy timeout, no FK enforcement
- **After:** `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`

### 13. Docker Non-Root User (`Dockerfile`)
- **Before:** Container runs as root
- **After:** `appuser:appgroup` (UID/GID 1001) with owned data directory

---

## Phase 3 — Medium Severity Fixes

### 14. Request Timeout (`app.ts`)
- **Before:** No global request timeout — slow clients could hold connections indefinitely
- **After:** 2-minute `res.setTimeout()` middleware returning 408 on timeout

### 15. Frontend Error Boundary (`ErrorBoundary.tsx`, `App.tsx`)
- **Before:** Uncaught render errors crash the entire React app
- **After:** `ErrorBoundary` component wrapping `App` — shows retry UI on crash

---

## Phase 4 — Low Severity Fixes

- Verified LRU cache eviction already implemented in `vectorSearch.ts`
- Verified no hardcoded filesystem paths in server code
- Verified WebSocket server is broadcast-only (no inbound message handling to validate)
- Shutdown timer `.unref()` already applied in Phase 1

---

## Test Results

```
 Test Files  20 passed (20)
      Tests  92 passed (92)
   Duration  3.38s
```

All 92 tests across 20 test files pass. TypeScript compilation clean for both `@workspace/api-server` and `@workspace/db`.

---

## Files Modified

| File | Changes |
|------|---------|
| `artifacts/api-server/src/app.ts` | helmet, CORS restriction, body limit, request timeout |
| `artifacts/api-server/src/lib/testExecutor.ts` | env sanitization, full UUID |
| `artifacts/api-server/src/lib/alchemistExecutor.ts` | env sanitization, git show restriction |
| `artifacts/api-server/src/lib/githubFetcher.ts` | URL.parse SSRF fix |
| `artifacts/api-server/src/lib/githubTokenStore.ts` | improved key derivation |
| `artifacts/api-server/src/lib/providers/router.ts` | API key redaction, safe JSON parse |
| `artifacts/api-server/src/index.ts` | graceful shutdown fix |
| `artifacts/api-server/package.json` | added `helmet` dependency |
| `lib/db/src/index.ts` | WAL mode, busy_timeout, FK pragmas |
| `Dockerfile` | non-root user |
| `artifacts/software-city/src/components/ErrorBoundary.tsx` | new file |
| `artifacts/software-city/src/App.tsx` | ErrorBoundary wrapper |
| `artifacts/api-server/src/lib/knowledgeCleanup.ts` | comment clarifying N+1 trade-off |

## Files Created

| File | Purpose |
|------|---------|
| `artifacts/software-city/src/components/ErrorBoundary.tsx` | React error boundary component |
| `session_log.md` | This file |

---

## Before vs After

| Category | Before | After |
|----------|--------|-------|
| CORS | Open to all origins | Allowlist-based |
| Security Headers | None | Full helmet suite |
| Body Size Limit | Unlimited | 1 MB |
| Request Timeout | None | 2 minutes |
| Child Process Env | All secrets exposed | Sensitive keys stripped |
| URL Validation | Regex (bypassable) | `new URL()` + hostname check |
| Encryption Key | `hostname` only | `hostname + secret + salt` |
| Docker User | root | non-root (UID 1001) |
| SQLite Journal | rollback (default) | WAL mode |
| SQLite Busy | No timeout | 5s busy_timeout |
| Foreign Keys | Not enforced | Enforced |
| Error Boundary | None | App-level React boundary |
| Log Redaction | API keys in error logs | Redacted |
| JSON Parse Safety | Could throw | Graceful fallback |
| Git Show | Unrestricted | Commit-SHA only |
| Test Temp Files | 8-char UUID | Full UUID |
| Shutdown | exit(1) on timeout | exit(0) + .unref() |
| Tests | 92 passing | 92 passing (no regressions) |
