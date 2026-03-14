# Smart Agents Handoff

## Scope Completed
Implemented role-specialized prompting, consultation workflow, personal learning memory updates, calibrated confidence classification, and specialty-aware targeting in autonomous and manual analysis paths.

## Evidence 1: Inspector Prompt Is Role-Specific
File: `artifacts/api-server/src/lib/smartAgents.ts`

Inspector prompt (excerpt):
```text
You are a meticulous bug hunter reviewing <language> code.
Look ONLY for: logic errors, null pointer risks,
unhandled promise rejections, incorrect conditionals,
off-by-one errors, missing return values.
Respond in JSON with finding, lineReference, severity, confidence, functionName.
If no real bug found: { finding: null }
```
This is generated via `buildRolePrompt(...)` when `persona === "inspector"` and is used by role-aware escalation.

## Evidence 2: Consultation Trigger + Log Line
File: `artifacts/api-server/src/lib/agentEngine.ts`

Consultation trigger logic:
- Inspector finding classified as `bug`
- Finding is security-adjacent
- System calls `consultAgent(...)` targeting Guardian

Consultation log format:
```text
🔍 Inspector consulted 🛡 Guardian on <filePath>
```
This is emitted to console and persisted/broadcast via event log (`CONSULTATION`).

## Evidence 3: Personal KB Save On Confirmed Finding
File: `artifacts/api-server/src/routes/agents.ts`

When `PATCH /agents/:agentId/verdict` receives `true_positive`:
1. Latest pending bug finding is marked `confirmed_true`.
2. Pattern is generated with `toMemoryPattern(...)`.
3. Personal KB is updated with `applyConfirmedFindingToPersonalKb(...)`.
4. Agent record is updated with serialized structured KB (`serializePersonalKb(...)`).

Proof log emitted:
```text
[PersonalKB] <agentName> stored confirmed pattern: <pattern>
```

## Evidence 4: Confidence Calibration Before/After
Files:
- `artifacts/api-server/src/lib/smartAgents.ts`
- `artifacts/api-server/src/lib/smartAgentWorkflow.ts`
- `artifacts/api-server/src/routes/agents.ts`

Calibration formula applied:
- `+0.10` personal KB pattern match
- `+0.05` personal experience
- `+0.10` shared KB pattern
- `+0.05` high accuracy
- `-0.10` low accuracy
- `-0.15` prior no-finding on file
- `-0.20` generic finding (no function)

Thresholds:
- `< 0.65` => `discarded`
- `0.65 - 0.80` => `observation`
- `> 0.80` => `bug`

Runtime evidence log (manual task path):
```text
confidence_calibration before=<x.xx> after=<y.yy>
```

## Evidence 5: Zero TypeScript Errors
Command:
```bash
pnpm run typecheck
```
Result:
- `artifacts/api-server` typecheck: done
- `artifacts/mockup-sandbox` typecheck: done
- `artifacts/software-city` typecheck: done
- `scripts` typecheck: done

No TypeScript errors remain.

## Files Changed (Smart-Agent Scope)
- `artifacts/api-server/src/lib/agentEngine.ts`
- `artifacts/api-server/src/lib/escalationEngine.ts`
- `artifacts/api-server/src/lib/smartAgents.ts`
- `artifacts/api-server/src/lib/smartAgentWorkflow.ts`
- `artifacts/api-server/src/routes/agents.ts`
