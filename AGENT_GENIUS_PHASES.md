# Agent Genius Upgrade Phases

## Goal
Turn Software City from heuristic bug hunting into a measurable, self-correcting coding intelligence loop.

## Definition Of "Coding Genius"
A high-performing agent system should improve all of these, not just finding volume:

- Prediction Accuracy Score (PAS): higher is better
- False Negative Rate (FNR): lower is better
- Confidence Calibration Index (CCI): higher is better
- Recommendation-to-Fix Conversion (RFC): higher is better
- Test Generation Effectiveness (TGE): higher is better

## KPI Contract (Phase 1)
- PAS = true_positives / (true_positives + false_positives)
- FNR = proxy_false_negative_signals / (bug_found_events + proxy_false_negative_signals)
- proxy_false_negative_signals = finding_discarded + finding_discarded_generic + 0.5 * finding_low_confidence
- CCI = 1 - mean_brier_error over confirmed_true/confirmed_false findings
- RFC = recommendation_feedback_approved / recommendation_feedback_total
- TGE = test_approved / test_proposed

## Phases

### Phase 1: KPI Contract + Telemetry Capture
Persist PAS/FNR/CCI/RFC/TGE in metric snapshots so improvement is measurable and trendable.

### Phase 2: Verdict-To-Learning Reinforcement
Link verdict outcomes to finding patterns and apply positive/negative reinforcement to agent memory and shared KB quality.

### Phase 3: KB Lineage + Poisoning Controls
Track provenance and rejection signals on KB entries; add integrity checks and semantic deduplication.

### Phase 4: Adaptive Confidence Gates
Replace static confidence thresholds with language- and context-aware quality gates.

### Phase 5: Directive-To-Execution Wiring
Ensure mayor/orchestrator directives directly influence target selection and routing behavior.

### Phase 6: Provider Performance Intelligence
Adapt provider ordering by observed quality and latency while preserving circuit-breaker safety.

### Phase 7: Dual Evaluation Harness
Add offline replay and online correlation benchmarks to quantify precision/recall and drift.

### Phase 8: Operator Dashboard + Release Gates
Expose KPI trends and block promotion when quality metrics regress.

## Current Status
- [x] Phase 1 implementation started
- [x] KPI schema fields added to `metric_snapshots`
- [x] Runtime migration support added for KPI columns
- [x] KPI math wired into `writeMetricSnapshot()`
- [x] `/api/metrics/contract` endpoint added
- [x] Tests added for KPI math and migration coverage
- [x] Phase 2 implementation started
- [x] `/api/agents/:agentId/verdict` now applies personal memory reinforcement and KB quality reinforcement
- [x] `/api/orchestrator/import-review` now reinforces personal memory and shared KB per verdict
- [x] `/api/orchestrator/recommendation-feedback` now applies reinforcement when linked finding evidence exists
- [ ] Phase 2 tuning and regression analytics pending
- [ ] Phases 3-8 pending

## Phase 1 Acceptance Criteria
- Every metric snapshot persists PAS/FNR/CCI/RFC/TGE and sample size
- KPI formulas are versioned and discoverable through API contract
- Migration is idempotent on existing databases
- Test coverage validates KPI math and migration behavior

## Validation Commands
- `pnpm run test:api`
- `pnpm run typecheck`
- Optional smoke: `pnpm run smoke:api`
