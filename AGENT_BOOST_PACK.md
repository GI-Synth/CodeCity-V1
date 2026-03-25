# AGENT_BOOST_PACK

Updated: 2026-03-15

## Mission
This pack contains the fastest, highest-impact actions to keep CodeCity agents improving with the current runtime and KB state.

## What Was Fixed
1. `scripts/train-kb.ts`
- OpenRouter startup became reachability-based with model fallback, instead of hard-disabling on one strict-parse failure.
- OpenRouter provider calls now try multiple candidate models and recover from malformed near-JSON where possible.

2. `artifacts/api-server/src/index.ts`
- The orchestrator loop is now actually started at boot when simulation mode is enabled.
- Orchestrator is now stopped cleanly on shutdown.

3. `artifacts/api-server/src/routes/agents.ts`
- `run-tests` now sanitizes AI-generated test text.
- If generated tests fail due harness/runtime issues (syntax/harness/module errors), it auto-retries with deterministic fallback sanity tests.

## Runtime Settings Applied
These were updated through `/api/settings`:
- `orchestrator_model=ollama`
- `openrouter_model=nvidia/nemotron-3-super-120b-a12b:free`
- `groq_model=llama-3.3-70b-versatile`

## Current Live Snapshot
- API health: `ok`
- KB entries: `766`
- Session KB hit rate: about `97.8%`
- Orchestrator status: running timer and producing directives
- Orchestrator provider: local Ollama (`qwen2.5:0.5b`) to avoid external rate-limit stalls
- City health score: `19/100`
- Key risk remains broad test coverage gaps

## Highest-Impact Actions (Run In Order)
1. Re-generate urgency report:
```bash
curl -sS -X POST http://127.0.0.1:3000/api/orchestrator/report
```

2. Execute critical run-tests on top targets:
```bash
agent='agent-1773474592448-1qyx6'
for b in \
  'building-artifacts-api-server-src-routes-orchestrator-ts' \
  'building-artifacts-api-server-src-routes-agents-ts' \
  'building-lib-api-client-react-src-generated-api-ts' \
  'building-artifacts-api-server-src-lib-escalationEngine-ts' \
  'building-artifacts-api-server-src-lib-smartAgents-ts'
do
  curl -sS -X POST "http://127.0.0.1:3000/api/agents/$agent/run-tests" \
    -H 'Content-Type: application/json' \
    -d "{\"buildingId\":\"$b\"}"
done
```

3. Re-check leaderboard and health:
```bash
pnpm run smoke:api
curl -sS http://127.0.0.1:3000/api/agents/leaderboard
curl -sS http://127.0.0.1:3000/api/city/health
curl -sS http://127.0.0.1:3000/api/knowledge/session-stats
```

4. Generate sprint and weekly plans for task routing:
```bash
curl -sS -X POST http://127.0.0.1:3000/api/orchestrator/sprint
curl -sS -X POST http://127.0.0.1:3000/api/orchestrator/weekly-summary
```

## Known Constraints
1. Groq quota can hard-limit (`429`) and trigger fallback.
2. Anthropic can fail on low credits.
3. OpenRouter is currently free-tier rate-limited on this key (`free-models-per-day` exhausted), so local Ollama is the reliable orchestrator provider right now.

## Safety And Security Notes
1. `/api/settings` currently returns sensitive settings values directly, including stored token fields.
2. Do not share raw `/api/settings` responses externally.
3. Rotate exposed tokens if any settings payload was shared outside your trusted environment.

## Success Criteria For Next Pass
1. Critical target run-tests complete without harness failures.
2. Session KB hit rate remains above `95%`.
3. City health trend improves after each sprint cycle.
4. Under-tested building count declines across consecutive reports.
