# CodeCity KB Learning Recovery Plan

Date: 2026-03-18
Scope: Restore real KB learning quality, reinforcement behavior, and trustworthy metrics.

## 1) Why this plan was updated

This version incorporates additional findings from reinforcement, orchestrator, settings, cleanup, tests, and environment code.

- Shared KB in the active runtime DB is tiny and narrow (5 rows), while findings are dominated by knowledge_base source decisions.
- Reinforcement is wired in multiple places, but no reinforcement events are currently present in runtime data.
- Personal KB is empty for all agents, so personal learning is not contributing.
- KPI formulas can overstate KB effectiveness in current conditions.
- Data hygiene/reset endpoints exist and can invalidate trend interpretation if used without controls.
- Review import and recommendation feedback already provide reinforcement entry points, but they are not producing meaningful active-loop reinforcement at runtime.
- Training progress JSON is resumable script metadata, not runtime truth.

## 2) Current baseline snapshot (runtime DB)

- Knowledge rows: 5
- Knowledge domains: general only
- Knowledge provider mix: groq only
- Distinct bug finding texts: 2
- Distinct bug files: 14
- Findings total: 6444
- Findings source knowledge_base: 5386
- Reinforcement events: 0
- Confirmed findings (confirmed_true or confirmed_false): 0
- Personal KB item count per agent: 0

Operational baseline notes:

- API dev script is not watch mode for process behavior changes; restart required for runtime validation.
- Simulation loop defaults to disabled in startup logic, but historical data can still bias metrics if reset/hygiene is not controlled.
- Cleanup scripts exist for reinforcement synthetic data and should be used before evaluating rollout KPIs.

## 3) Program goals and hard gates

Primary goals:

- Make KB metrics reflect real quality, not counter artifacts.
- Increase diversity and precision of bug findings.
- Activate reinforcement loop with measurable applied events.
- Grow shared and personal KB with evidence-based updates.

Hard rollout gates:

- Reinforcement coverage >= 0.60 over 24h.
- Reinforcement attempts >= 10 over 24h.
- PAS non-regression >= -0.01 over window.
- FNR non-regression <= +0.02 over window.
- CCI non-regression >= -0.02 over window.
- Distinct bug finding texts >= 10 over 24h active run.
- Distinct issue patterns in reinforcement events >= 5 over 24h active run.

## 4) Workstreams

### WS1: Measurement integrity first

Objective: prevent false confidence from saturated or misleading KPIs.

Primary files:

- artifacts/api-server/src/routes/metrics.ts
- artifacts/api-server/src/lib/orchestrator.ts
- artifacts/api-server/src/routes/city.ts
- artifacts/software-city/src/pages/Metrics.tsx

Tasks:

- Replace KB hit rate denominator logic to use total task activity consistently.
- Split KB metrics into retrieval activity and quality effectiveness.
- Add explicit metric for distinct bug finding text count over window.
- Add explicit metric for reinforcement diversity (distinct issue_pattern).
- Ensure UI labels indicate the exact formula and sample base.

Acceptance:

- No stable 1.0 KB hit rate unless justified by denominator and volume.
- API and UI display same KPI semantics.
- metrics history exposes diversity metrics.

### WS2: Retrieval quality and anti-repeat controls

Objective: stop repetitive bug spam and improve signal precision.

Primary files:

- artifacts/api-server/src/lib/smartAgentWorkflow.ts
- artifacts/api-server/src/lib/findingQuality.ts
- artifacts/api-server/src/lib/smartAgents.ts
- artifacts/api-server/src/lib/escalationEngine.ts

Tasks:

- Add repeat-finding cooldown by finding fingerprint and file path.
- Downgrade repeated bug claims to observation unless new evidence appears.
- Add novelty score to accepted bug findings.
- Tighten generic finding rejection when function and line references are absent.
- Keep role-aware prompts but enforce stronger evidence for repeated pattern reuse.

Acceptance:

- Distinct bug text count rises materially in active runs.
- Top single finding text no longer dominates bug findings.
- Observation volume may rise short-term while false-positive bug volume falls.

### WS3: KB usage counter correctness

Objective: make KB usage counters trustworthy.

Primary files:

- artifacts/api-server/src/lib/escalationEngine.ts
- artifacts/api-server/src/routes/knowledge.ts

Tasks:

- Convert KB use_count update path to atomic increment semantics.
- Avoid stale cached row writeback for counter updates.
- Add trace fields for retrieval source and similarity during KB hits.

Acceptance:

- use_count growth aligns with measured kbHits telemetry trend.
- knowledge.stats totalCacheHits and per-row use_count move coherently.

### WS4: Reinforcement loop activation

Objective: move from passive pending findings to applied reinforcement.

Primary files:

- artifacts/api-server/src/routes/agents.ts
- artifacts/api-server/src/routes/orchestrator.ts
- artifacts/api-server/src/lib/learningReinforcement.ts
- artifacts/api-server/src/lib/reinforcementTelemetry.ts
- artifacts/api-server/src/routes/metrics.ts

Tasks:

- Add a controlled verdict workflow to resolve pending findings continuously.
- Ensure recommendation-feedback and import-review events produce applied reinforcement where evidence is sufficient.
- Add telemetry for attempted vs applied reasons (cooldown, low evidence, no match).
- Add dashboard surfaces for top reinforced patterns and cooldown skips.

Acceptance:

- reinforcement_events table receives real non-synthetic rows in active runs.
- applied count increases and remains non-zero.
- reinforcement summary trend shows both boosts and decays.

### WS5: Shared KB corpus rebuild and diversity constraints

Objective: expand from narrow seed state to broad, useful corpus.

Primary files:

- scripts/train-kb.ts
- scripts/seed-knowledge.ts
- artifacts/api-server/src/lib/knowledgeCleanup.ts
- artifacts/api-server/src/index.ts

Tasks:

- Rebuild shared KB using active runtime DB path.
- Add minimum diversity constraints by domain, language, and problem type.
- Reject low-information duplicate templates during ingestion.
- Preserve startup cleanup for non-source noise while avoiding over-pruning valid source knowledge.

Acceptance:

- KB entries increase with balanced domain/language distribution.
- distinct problem_type count grows beyond narrow baseline.
- search relevance improves without repeated generic bug templates.

### WS6: Personal KB growth and decay behavior

Objective: make agent-specific learning active and stable.

Primary files:

- artifacts/api-server/src/lib/learningReinforcement.ts
- artifacts/api-server/src/lib/smartAgentWorkflow.ts
- artifacts/api-server/src/routes/agents.ts

Tasks:

- Ensure confirmed verdicts consistently update personal KB.
- Add safeguards against noisy overgrowth and stale-memory drift.
- Add per-agent personal KB stats endpoint fields.

Acceptance:

- Non-zero personal KB item counts for active agents.
- Personal KB confidence changes correlate with verdict outcomes.

### WS7: Data hygiene and environment controls

Objective: prevent synthetic or reset artifacts from contaminating metrics.

Primary files:

- scripts/cleanup-reinforcement-data.ts
- artifacts/api-server/src/lib/reinforcementDataHygiene.ts
- artifacts/api-server/src/routes/events.ts
- artifacts/api-server/src/routes/orchestrator.ts
- artifacts/api-server/src/index.ts

Tasks:

- Run synthetic reinforcement cleanup before KPI evaluation windows.
- Add operator runbook for destructive control endpoints.
- Require explicit confirmation and audit events for wipe/reset operations.
- Mark metric windows invalid after full-reset/wipe actions.

Acceptance:

- Rollout windows are based on clean, non-synthetic data.
- Reset actions are visible and auditable.

### WS8: Test coverage and rollout verification

Objective: lock changes with deterministic tests and automated gates.

Primary files:

- artifacts/api-server/tests/metricsKpiMath.test.ts
- artifacts/api-server/tests/knowledgeSessionStatsTrend.test.ts
- artifacts/api-server/tests/learningReinforcement.test.ts
- artifacts/api-server/tests/reinforcementDataHygiene.test.ts
- artifacts/api-server/tests/reinforcementEntryPoints.test.ts
- scripts/check-rollout-gates.ts
- scripts/smoke-api.ts
- scripts/validate-loop.ts

Tasks:

- Add tests for updated KPI formulas and denominator semantics.
- Add tests for anti-repeat bug filtering and novelty gating.
- Add tests for atomic KB counter updates.
- Add tests for reinforcement applied/not-applied reason accounting.
- Extend rollout-gate script checks for diversity and reinforcement activity.

Acceptance:

- test:api and smoke:api pass on clean runtime.
- rollout-gates pass with new diversity and reinforcement requirements.

## 5) Execution phases (recommended order)

### Phase 0: Baseline and data hygiene lock

- Capture baseline DB snapshot and KPI outputs.
- Run synthetic reinforcement cleanup in dry-run and apply mode as needed.
- Freeze resets/wipes during measurement windows.

Deliverable:

- Baseline report with timestamped metrics and data quality status.

### Phase 1: Metric integrity patch

- Implement WS1 and WS3.
- Update UI labels and KPI contract docs.

Deliverable:

- Trustworthy KPI semantics in API and UI.

### Phase 2: Finding quality and anti-repeat

- Implement WS2.
- Validate bug diversity improvement in active run.

Deliverable:

- Reduced repeated bug spam and improved finding precision.

### Phase 3: Reinforcement activation

- Implement WS4 and WS6.
- Verify applied reinforcement flows.

Deliverable:

- Non-zero real reinforcement with visible trend data.

### Phase 4: Corpus rebuild and cleanup tuning

- Implement WS5.
- Re-run embeddings and cache rebuild.

Deliverable:

- Larger, more diverse KB corpus with stable retrieval quality.

### Phase 5: Verification and rollout decision

- Implement WS8.
- Run full checks and rollout gates.

Deliverable:

- Go/no-go decision based on hard gates.

## 6) Operational checklist

Pre-change checklist:

- Confirm active DB path.
- Record output of metrics history and reinforcement summary.
- Record findings source mix and distinct bug text count.

Post-change checklist:

- Run pnpm run typecheck
- Run pnpm run test:api
- Run pnpm run smoke:api
- Run pnpm validate
- Run pnpm run check:rollout-gates

Data hygiene checklist:

- Run cleanup-reinforcement-data dry-run.
- Run cleanup-reinforcement-data apply if synthetic rows exist.
- Verify reinforcement-summary excludes synthetic events.

## 7) Risks and mitigations

- Risk: stricter finding filters reduce bug count temporarily.
- Mitigation: evaluate precision and diversity, not raw bug count only.

- Risk: reinforcement cooldown blocks updates in low-volume windows.
- Mitigation: expose cooldown-skipped metrics and tune controls via metrics controls API.

- Risk: over-pruning knowledge during startup cleanup.
- Mitigation: add safety checks for source-file evidence before deletion.

- Risk: destructive control endpoints distort trend analysis.
- Mitigation: add reset audit markers and invalidate affected metric windows.

## 8) Out of scope for this plan

- Large UX redesign of dashboards unrelated to KPI correctness.
- New provider integrations beyond existing provider chain.
- Full migration away from current findings/event schema.

## 9) Immediate next implementation batch

Batch A (highest priority):

- WS1 metric integrity updates.
- WS3 atomic KB counter update.
- WS8 tests for metric and counter correctness.

Expected outcome after Batch A:

- KPI trust improves immediately.
- Reported KB impact aligns with real behavior.
- Future optimization decisions become data-valid.
