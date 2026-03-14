# FIX_HANDOFF

Scope: Harden agent bug reporting quality and urgency report trustworthiness.

## Implemented Fixes

### 1) Confidence + Source + Specificity Gate
- Added shared quality pipeline in `artifacts/api-server/src/lib/findingQuality.ts`.
- Findings now pass only if all are true:
  - Source file extension is one of: `.ts`, `.js`, `.py`, `.go`, `.rs`
  - Confidence is at least `0.75`
  - Finding text is specific (generic/noise patterns are discarded)
- Gate is enforced in the active workflow path (`smartAgentWorkflow`) before bug classification is persisted.
- Low-confidence candidates are routed to observations (not bugs):
  - Agent `observations` updated
  - `city_events` row recorded as `type = 'finding_low_confidence'`

### 2) 24h De-duplication by `filePath + issueType`
- Implemented in `classifyAndPersistBugFinding(...)` in `artifacts/api-server/src/lib/findingQuality.ts`.
- Query window: last 24 hours, `type = 'bug_found'`, same `file_path`, same `issue_type`.
- Duplicate behavior:
  - Increment existing row `confirmations = confirmations + 1`
  - Record a `finding_kept` event for audit trail
- New finding behavior:
  - Insert `bug_found` with structured fields and `confirmations = 1`

### 3) Mandatory Severity Classification
- Added `classifyFindingSeverity(...)` to `artifacts/api-server/src/lib/escalationEngine.ts`.
- Primary classifier: Groq prompt that returns exactly one label:
  - `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`
- Fallback classifier: keyword-based severity mapping when Groq is unavailable/rate-limited.
- Severity is persisted into `city_events.finding_severity`.

### 4) Generic Finding Rejection + Logging
- Generic findings are discarded before bug persistence.
- Discards are stored as `city_events` rows with `type = 'finding_discarded_generic'`.
- Added QA log line:
  - `[QA] Discarded generic finding in <filePath>`

### 5) `/api/orchestrator/report` Severity Buckets + Rich Finding Details
- Updated `POST /api/orchestrator/report` in `artifacts/api-server/src/routes/orchestrator.ts`.
- Report now uses only structured, classified bug events.
- Output includes strict buckets:
  - `## Critical (N)`
  - `## High (N)`
  - `## Medium (N)`
  - `## Low (N)`
- Each finding bullet now includes:
  - Severity badge
  - Confidence percent
  - Agent name
  - Code reference
  - Confirmation count

## Schema + Migration Work

### `agents` table
- Added `observations` JSON text column (default `[]`) in:
  - `lib/db/src/schema/agents.ts`
  - runtime migration in `lib/db/src/index.ts`

### `city_events` table
- Added structured finding columns in `lib/db/src/schema/events.ts`:
  - `file_path`, `issue_type`, `confidence`, `code_reference`, `confirmations`, `finding_severity`, `finding_text`
- Added runtime migration + index in `lib/db/src/index.ts`:
  - index over `(type, file_path, issue_type, timestamp)`

## Files Changed

- `artifacts/api-server/src/lib/findingQuality.ts` (new)
- `artifacts/api-server/src/lib/escalationEngine.ts`
- `artifacts/api-server/src/lib/smartAgentWorkflow.ts`
- `artifacts/api-server/src/routes/agents.ts`
- `artifacts/api-server/src/lib/agentEngine.ts`
- `artifacts/api-server/src/routes/orchestrator.ts`
- `artifacts/api-server/src/index.ts`
- `lib/db/src/schema/agents.ts`
- `lib/db/src/schema/events.ts`
- `lib/db/src/index.ts`

## Verification

### Typecheck
- Command: `pnpm run typecheck`
- Result: passed with zero errors.

### Report Endpoint
- Command: `curl -sS -X POST http://127.0.0.1:3000/api/orchestrator/report`
- Result: endpoint returned severity-bucketed report with strict sections and detailed finding formatting.

## Filter Metrics (Current DB Snapshot)

Query used:

```sql
SELECT 'passed' AS metric, COUNT(*) AS count
FROM city_events
WHERE type IN ('bug_found','finding_kept')
  AND finding_severity IN ('CRITICAL','HIGH','MEDIUM','LOW')
  AND file_path IS NOT NULL
  AND issue_type IS NOT NULL
  AND confidence >= 0.75
UNION ALL
SELECT 'discarded_generic', COUNT(*)
FROM city_events
WHERE type = 'finding_discarded_generic'
UNION ALL
SELECT 'discarded_low_confidence', COUNT(*)
FROM city_events
WHERE type = 'finding_low_confidence';
```

Current values:
- `passed`: `0`
- `discarded_generic`: `0`
- `discarded_low_confidence`: `25`

Note: `passed` remains `0` in this snapshot because no source findings have yet cleared all trust gates and been persisted as classified bug events.
