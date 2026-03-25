import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  metricSnapshotsTable,
  agentsTable,
  eventsTable,
  findingsTable,
  reposTable,
  reinforcementEventsTable,
  settingsTable,
} from "@workspace/db/schema";
import { desc, gte, count, eq, sql } from "drizzle-orm";
import {
  getReinforcementControls,
  runReinforcementAgingIfDue,
  updateReinforcementControls,
  type ReinforcementControls,
} from "../lib/reinforcementTelemetry";
import {
  getReinforcementCorruptionTelemetry,
  type ReinforcementCorruptionTelemetry,
} from "../lib/learningReinforcement";
import { filterNonSyntheticReinforcementEvents } from "../lib/reinforcementDataHygiene";

const router: IRouter = Router();

type KpiSourceAggregates = {
  truePositives: number;
  falsePositives: number;
  averageAccuracy: number;
  bugFoundEvents: number;
  discardedFindingEvents: number;
  lowConfidenceEvents: number;
  recommendationApproved: number;
  recommendationTotal: number;
  testProposed: number;
  testApproved: number;
  resolvedFindings: number;
  brierTotal: number;
};

export type PhaseOneKpis = {
  predictionAccuracyScore: number;
  falseNegativeRate: number;
  confidenceCalibrationIndex: number;
  recommendationFixConversion: number;
  testGenerationEffectiveness: number;
  kpiSampleSize: number;
};

type ReinforcementSummaryResponse = {
  hours: number;
  since: string;
  totals: {
    attempts: number;
    applied: number;
    boosts: number;
    decays: number;
    net: number;
    coverage: number;
  };
  topBoostPatterns: Array<{ issuePattern: string; count: number }>;
  topDecayPatterns: Array<{ issuePattern: string; count: number }>;
  topAgentDeltas: Array<{ agentName: string; agentId: string | null; boosts: number; decays: number; net: number }>;
  trend: Array<{ bucket: string; boosts: number; decays: number; net: number }>;
  smarterPercentEstimate: number;
  smarterPercentComponents: {
    pasDelta: number;
    fnrDelta: number;
    cciDelta: number;
    coverageLift: number;
  } | null;
  corruptionHandling: ReinforcementCorruptionTelemetry;
};

const KPI_CONTRACT = {
  version: "phase2-v1",
  metrics: {
    predictionAccuracyScore: {
      shortName: "PAS",
      range: "0..1",
      objective: "higher_is_better",
      formula: "true_positives / (true_positives + false_positives)",
      fallback: "average agent accuracy when no verdict-backed outcomes exist",
    },
    falseNegativeRate: {
      shortName: "FNR",
      range: "0..1",
      objective: "lower_is_better",
      formula: "proxy_false_negative_signals / (bug_found_events + proxy_false_negative_signals)",
      proxySignals: "finding_discarded + finding_discarded_generic + 0.5 * finding_low_confidence",
    },
    confidenceCalibrationIndex: {
      shortName: "CCI",
      range: "0..1",
      objective: "higher_is_better",
      formula: "1 - mean_brier_error over confirmed_true/confirmed_false findings",
    },
    recommendationFixConversion: {
      shortName: "RFC",
      range: "0..1",
      objective: "higher_is_better",
      formula: "recommendation_feedback_approved / recommendation_feedback_total",
    },
    testGenerationEffectiveness: {
      shortName: "TGE",
      range: "0..1",
      objective: "higher_is_better",
      formula: "test_approved / test_proposed",
    },
    reinforcementCoverage: {
      shortName: "RCV",
      range: "0..1",
      objective: "higher_is_better",
      formula: "reinforcement_applied / reinforcement_attempts",
      fallback: "0 when no reinforcement attempts exist",
    },
    reinforcementNet: {
      shortName: "RNET",
      range: "unbounded integer",
      objective: "contextual",
      formula: "reinforcement_boosts - reinforcement_decays",
      note: "A healthy net should stay positive without suppressing false-positive decay signals.",
    },
  },
} as const;

const REINFORCEMENT_CONTROL_SETTINGS_KEY = "phase2_reinforcement_controls";
let reinforcementControlsHydrated = false;

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function parseHoursParam(raw: unknown, fallback = 24): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(168, Math.max(1, Math.round(parsed)));
}

function toIsoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function toHourBucket(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) {
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    return now.toISOString();
  }

  parsed.setUTCMinutes(0, 0, 0);
  return parsed.toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseControlPatch(value: unknown): Partial<ReinforcementControls> | null {
  const input = asObject(value);
  if (!input) return null;

  const patch: Partial<ReinforcementControls> = {};
  if (typeof input["enabled"] === "boolean") patch.enabled = input["enabled"];
  if (typeof input["perEventMaxDelta"] === "number") patch.perEventMaxDelta = input["perEventMaxDelta"];
  if (typeof input["patternCooldownMinutes"] === "number") patch.patternCooldownMinutes = input["patternCooldownMinutes"];
  if (typeof input["minEvidenceConfidence"] === "number") patch.minEvidenceConfidence = input["minEvidenceConfidence"];
  if (typeof input["personalKbStaleDays"] === "number") patch.personalKbStaleDays = input["personalKbStaleDays"];
  if (typeof input["personalKbStaleDecay"] === "number") patch.personalKbStaleDecay = input["personalKbStaleDecay"];
  if (typeof input["knowledgeStaleDays"] === "number") patch.knowledgeStaleDays = input["knowledgeStaleDays"];
  if (typeof input["knowledgeStaleDecay"] === "number") patch.knowledgeStaleDecay = input["knowledgeStaleDecay"];
  if (typeof input["maxAgingUpdatesPerRun"] === "number") patch.maxAgingUpdatesPerRun = input["maxAgingUpdatesPerRun"];
  return patch;
}

async function persistReinforcementControls(controls: ReinforcementControls): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(settingsTable).values({
    key: REINFORCEMENT_CONTROL_SETTINGS_KEY,
    value: JSON.stringify(controls),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: settingsTable.key,
    set: {
      value: JSON.stringify(controls),
      updatedAt: now,
    },
  });
}

async function hydrateReinforcementControls(): Promise<ReinforcementControls> {
  if (reinforcementControlsHydrated) return getReinforcementControls();

  const rows = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, REINFORCEMENT_CONTROL_SETTINGS_KEY))
    .limit(1)
    .catch(() => []);

  const raw = rows[0]?.value;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const patch = parseControlPatch(parsed);
      if (patch) {
        updateReinforcementControls(patch);
      }
    } catch {
      // Ignore malformed persisted settings and keep runtime defaults.
    }
  }

  reinforcementControlsHydrated = true;
  return getReinforcementControls();
}

function calculateSmarterPercentEstimate(params: {
  baseline: { pas: number; fnr: number; cci: number };
  current: { pas: number; fnr: number; cci: number };
  reinforcementCoverage: number;
}): { score: number; components: { pasDelta: number; fnrDelta: number; cciDelta: number; coverageLift: number } } {
  const pasDelta = params.current.pas - params.baseline.pas;
  const fnrDelta = params.baseline.fnr - params.current.fnr;
  const cciDelta = params.current.cci - params.baseline.cci;
  const coverageLift = params.reinforcementCoverage - 0.5;

  const weighted = (pasDelta * 0.45) + (fnrDelta * 0.30) + (cciDelta * 0.20) + (coverageLift * 0.05);
  const bounded = Math.max(-1, Math.min(1, weighted));

  return {
    score: round4(bounded * 100),
    components: {
      pasDelta: round4(pasDelta),
      fnrDelta: round4(fnrDelta),
      cciDelta: round4(cciDelta),
      coverageLift: round4(coverageLift),
    },
  };
}

async function buildReinforcementSummary(hours: number): Promise<ReinforcementSummaryResponse> {
  const since = toIsoHoursAgo(hours);

  const [events, snapshots] = await Promise.all([
    db.select({
      timestamp: reinforcementEventsTable.timestamp,
      eventType: reinforcementEventsTable.eventType,
      source: reinforcementEventsTable.source,
      verdictOrigin: reinforcementEventsTable.verdictOrigin,
      findingId: reinforcementEventsTable.findingId,
      issuePattern: reinforcementEventsTable.issuePattern,
      agentId: reinforcementEventsTable.agentId,
      agentName: reinforcementEventsTable.agentName,
      attempted: reinforcementEventsTable.attempted,
      applied: reinforcementEventsTable.applied,
    })
      .from(reinforcementEventsTable)
      .where(gte(reinforcementEventsTable.timestamp, since))
      .orderBy(desc(reinforcementEventsTable.id))
      .limit(5000),
    db.select({
      predictionAccuracyScore: metricSnapshotsTable.predictionAccuracyScore,
      falseNegativeRate: metricSnapshotsTable.falseNegativeRate,
      confidenceCalibrationIndex: metricSnapshotsTable.confidenceCalibrationIndex,
      timestamp: metricSnapshotsTable.timestamp,
    })
      .from(metricSnapshotsTable)
      .where(gte(metricSnapshotsTable.timestamp, since))
      .orderBy(metricSnapshotsTable.timestamp)
      .limit(2000),
  ]);
  const realEvents = filterNonSyntheticReinforcementEvents(events);

  let attempts = 0;
  let applied = 0;
  let boosts = 0;
  let decays = 0;

  const boostPatterns = new Map<string, number>();
  const decayPatterns = new Map<string, number>();
  const agentDeltas = new Map<string, { agentName: string; agentId: string | null; boosts: number; decays: number }>();
  const trendBuckets = new Map<string, { boosts: number; decays: number }>();

  for (const event of realEvents) {
    const attemptedValue = Math.max(0, Math.round(toNumber(event.attempted)));
    const appliedValue = Math.max(0, Math.round(toNumber(event.applied)));
    const eventType = event.eventType;
    const issuePattern = (event.issuePattern ?? "general").trim() || "general";
    const agentKey = `${event.agentId ?? "none"}:${event.agentName ?? "unknown"}`;
    const bucket = toHourBucket(event.timestamp);

    attempts += attemptedValue;
    applied += appliedValue;

    const trend = trendBuckets.get(bucket) ?? { boosts: 0, decays: 0 };
    if (eventType === "phase2_reinforcement_boost") {
      boosts += 1;
      trend.boosts += 1;
      boostPatterns.set(issuePattern, (boostPatterns.get(issuePattern) ?? 0) + 1);
    } else if (eventType === "phase2_reinforcement_decay") {
      decays += 1;
      trend.decays += 1;
      decayPatterns.set(issuePattern, (decayPatterns.get(issuePattern) ?? 0) + 1);
    }
    trendBuckets.set(bucket, trend);

    const existing = agentDeltas.get(agentKey) ?? {
      agentName: (event.agentName ?? "Unattributed").trim() || "Unattributed",
      agentId: event.agentId ?? null,
      boosts: 0,
      decays: 0,
    };

    if (eventType === "phase2_reinforcement_boost") existing.boosts += 1;
    if (eventType === "phase2_reinforcement_decay") existing.decays += 1;
    agentDeltas.set(agentKey, existing);
  }

  const topBoostPatterns = Array.from(boostPatterns.entries())
    .map(([issuePattern, countValue]) => ({ issuePattern, count: countValue }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topDecayPatterns = Array.from(decayPatterns.entries())
    .map(([issuePattern, countValue]) => ({ issuePattern, count: countValue }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topAgentDeltas = Array.from(agentDeltas.values())
    .map((entry) => ({
      agentName: entry.agentName,
      agentId: entry.agentId,
      boosts: entry.boosts,
      decays: entry.decays,
      net: entry.boosts - entry.decays,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 10);

  const trend = Array.from(trendBuckets.entries())
    .map(([bucket, values]) => ({
      bucket,
      boosts: values.boosts,
      decays: values.decays,
      net: values.boosts - values.decays,
    }))
    .sort((a, b) => Date.parse(a.bucket) - Date.parse(b.bucket));

  const coverage = attempts > 0 ? clamp01(applied / attempts) : 0;
  const baseline = snapshots[0];
  const current = snapshots[snapshots.length - 1];

  const smarter = baseline && current
    ? calculateSmarterPercentEstimate({
      baseline: {
        pas: clamp01(toNumber(baseline.predictionAccuracyScore)),
        fnr: clamp01(toNumber(baseline.falseNegativeRate)),
        cci: clamp01(toNumber(baseline.confidenceCalibrationIndex)),
      },
      current: {
        pas: clamp01(toNumber(current.predictionAccuracyScore)),
        fnr: clamp01(toNumber(current.falseNegativeRate)),
        cci: clamp01(toNumber(current.confidenceCalibrationIndex)),
      },
      reinforcementCoverage: coverage,
    })
    : null;

  return {
    hours,
    since,
    totals: {
      attempts,
      applied,
      boosts,
      decays,
      net: boosts - decays,
      coverage: round4(coverage),
    },
    topBoostPatterns,
    topDecayPatterns,
    topAgentDeltas,
    trend,
    smarterPercentEstimate: smarter?.score ?? 0,
    smarterPercentComponents: smarter?.components ?? null,
    corruptionHandling: getReinforcementCorruptionTelemetry(),
  };
}

function extractCoverageOverall(layoutData: string | null): number | null {
  if (!layoutData) return null;

  try {
    const parsed = JSON.parse(layoutData) as {
      districts?: Array<{ buildings?: Array<{ testCoverage?: number }> }>;
    };

    const buildings = (parsed.districts ?? []).flatMap((district) => district.buildings ?? []);
    if (buildings.length === 0) return null;

    const coverageValues = buildings
      .map((building) => toNumber(building.testCoverage))
      .filter((value) => Number.isFinite(value));

    if (coverageValues.length === 0) return null;

    const total = coverageValues.reduce((sum, value) => sum + value, 0);
    return clamp01(total / coverageValues.length);
  } catch {
    return null;
  }
}

export function calculatePhaseOneKpis(aggregates: KpiSourceAggregates): PhaseOneKpis {
  const truePositives = toNumber(aggregates.truePositives);
  const falsePositives = toNumber(aggregates.falsePositives);
  const averageAccuracy = clamp01(toNumber(aggregates.averageAccuracy));

  const bugFoundEvents = toNumber(aggregates.bugFoundEvents);
  const discardedFindingEvents = toNumber(aggregates.discardedFindingEvents);
  const lowConfidenceEvents = toNumber(aggregates.lowConfidenceEvents);

  const recommendationApproved = toNumber(aggregates.recommendationApproved);
  const recommendationTotal = toNumber(aggregates.recommendationTotal);

  const testProposed = toNumber(aggregates.testProposed);
  const testApproved = toNumber(aggregates.testApproved);

  const resolvedFindings = toNumber(aggregates.resolvedFindings);
  const brierTotal = Math.max(0, toNumber(aggregates.brierTotal));

  const pasDenominator = truePositives + falsePositives;
  const predictionAccuracyScore = pasDenominator > 0
    ? truePositives / pasDenominator
    : averageAccuracy;

  const falseNegativeSignals = discardedFindingEvents + (0.5 * lowConfidenceEvents);
  const fnrDenominator = bugFoundEvents + falseNegativeSignals;
  const falseNegativeRate = fnrDenominator > 0
    ? falseNegativeSignals / fnrDenominator
    : 0;

  const confidenceCalibrationIndex = resolvedFindings > 0
    ? 1 - (brierTotal / resolvedFindings)
    : 0;

  const recommendationFixConversion = recommendationTotal > 0
    ? recommendationApproved / recommendationTotal
    : 0;

  const testGenerationEffectiveness = testProposed > 0
    ? testApproved / testProposed
    : 0;

  return {
    predictionAccuracyScore: round4(clamp01(predictionAccuracyScore)),
    falseNegativeRate: round4(clamp01(falseNegativeRate)),
    confidenceCalibrationIndex: round4(clamp01(confidenceCalibrationIndex)),
    recommendationFixConversion: round4(clamp01(recommendationFixConversion)),
    testGenerationEffectiveness: round4(clamp01(testGenerationEffectiveness)),
    kpiSampleSize: Math.max(0, Math.round(Math.max(resolvedFindings, pasDenominator))),
  };
}

router.get("/contract", (_req, res) => {
  res.json(KPI_CONTRACT);
});

router.get("/reinforcement-controls", async (_req, res) => {
  try {
    const controls = await hydrateReinforcementControls();
    res.json({ controls, settingKey: REINFORCEMENT_CONTROL_SETTINGS_KEY });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "REINFORCEMENT_CONTROLS_ERROR", message });
  }
});

router.patch("/reinforcement-controls", async (req, res) => {
  try {
    await hydrateReinforcementControls();

    const patch = parseControlPatch(req.body);
    if (!patch || Object.keys(patch).length === 0) {
      res.status(400).json({
        error: "INVALID_REINFORCEMENT_CONTROLS",
        message: "Provide at least one valid controls field in request body",
      });
      return;
    }

    const controls = updateReinforcementControls(patch);
    await persistReinforcementControls(controls);

    res.json({ success: true, controls });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "REINFORCEMENT_CONTROLS_UPDATE_ERROR", message });
  }
});

router.get("/reinforcement-summary", async (req, res) => {
  try {
    const hours = parseHoursParam(req.query["hours"], 24);
    const summary = await buildReinforcementSummary(hours);
    res.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "REINFORCEMENT_SUMMARY_ERROR", message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const hours = parseHoursParam(req.query["hours"], 24);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const snapshots = await db
      .select()
      .from(metricSnapshotsTable)
      .where(gte(metricSnapshotsTable.timestamp, since))
      .orderBy(desc(metricSnapshotsTable.timestamp))
      .limit(1000);

    res.json({
      snapshots: snapshots.reverse(),
      hours,
      count: snapshots.length,
      kpiContractVersion: KPI_CONTRACT.version,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "METRICS_HISTORY_ERROR", message });
  }
});

export async function writeMetricSnapshot() {
  try {
    await hydrateReinforcementControls();
    const aging = await runReinforcementAgingIfDue().catch(() => ({
      ran: false,
      personalEntriesDecayed: 0,
      knowledgeEntriesDecayed: 0,
    }));
    const reinforcementSince = toIsoHoursAgo(24);

    const [
      [agentStats],
      [eventStats],
      [findingStats],
      reinforcementRows,
      activeRepoRows,
    ] = await Promise.all([
      db.select({
        activeAgents: sql<number>`coalesce(sum(case when ${agentsTable.status} = 'working' then 1 else 0 end), 0)`,
        pausedAgents: sql<number>`coalesce(sum(case when ${agentsTable.status} = 'paused' then 1 else 0 end), 0)`,
        totalBugs: sql<number>`coalesce(sum(${agentsTable.bugsFound}), 0)`,
        totalEscalations: sql<number>`coalesce(sum(${agentsTable.escalations}), 0)`,
        totalTasks: sql<number>`coalesce(sum(${agentsTable.testsGenerated}), 0)`,
        totalKbHits: sql<number>`coalesce(sum(${agentsTable.kbHits}), 0)`,
        truePositives: sql<number>`coalesce(sum(${agentsTable.truePositives}), 0)`,
        falsePositives: sql<number>`coalesce(sum(${agentsTable.falsePositives}), 0)`,
        averageAccuracy: sql<number>`coalesce(avg(${agentsTable.accuracy}), 0)`,
      }).from(agentsTable),
      db.select({
        bugFoundEvents: sql<number>`coalesce(sum(case when ${eventsTable.type} = 'bug_found' then 1 else 0 end), 0)`,
        discardedFindingEvents: sql<number>`coalesce(sum(case when ${eventsTable.type} in ('finding_discarded', 'finding_discarded_generic') then 1 else 0 end), 0)`,
        lowConfidenceEvents: sql<number>`coalesce(sum(case when ${eventsTable.type} = 'finding_low_confidence' then 1 else 0 end), 0)`,
        recommendationApproved: sql<number>`coalesce(sum(case when ${eventsTable.type} = 'recommendation_feedback' and ${eventsTable.severity} = 'info' then 1 else 0 end), 0)`,
        recommendationTotal: sql<number>`coalesce(sum(case when ${eventsTable.type} = 'recommendation_feedback' then 1 else 0 end), 0)`,
        testProposed: sql<number>`coalesce(sum(case when ${eventsTable.type} = 'test_proposed' then 1 else 0 end), 0)`,
        testApproved: sql<number>`coalesce(sum(case when ${eventsTable.type} = 'test_approved' then 1 else 0 end), 0)`,
      }).from(eventsTable),
      db.select({
        resolvedFindings: sql<number>`coalesce(sum(case when ${findingsTable.status} in ('confirmed_true', 'confirmed_false') then 1 else 0 end), 0)`,
        brierTotal: sql<number>`coalesce(sum(case when ${findingsTable.status} = 'confirmed_true' then (1.0 - ${findingsTable.finalConfidence}) * (1.0 - ${findingsTable.finalConfidence}) when ${findingsTable.status} = 'confirmed_false' then (${findingsTable.finalConfidence}) * (${findingsTable.finalConfidence}) else 0 end), 0)`,
      }).from(findingsTable),
      db.select({
        attempted: reinforcementEventsTable.attempted,
        applied: reinforcementEventsTable.applied,
        eventType: reinforcementEventsTable.eventType,
        source: reinforcementEventsTable.source,
        verdictOrigin: reinforcementEventsTable.verdictOrigin,
        findingId: reinforcementEventsTable.findingId,
      }).from(reinforcementEventsTable).where(gte(reinforcementEventsTable.timestamp, reinforcementSince)),
      db.select({
        healthScore: reposTable.healthScore,
        layoutData: reposTable.layoutData,
      }).from(reposTable).where(eq(reposTable.isActive, true)).limit(1),
    ]);

    const repoRow = activeRepoRows[0]
      ?? (await db.select({
        healthScore: reposTable.healthScore,
        layoutData: reposTable.layoutData,
      }).from(reposTable).orderBy(desc(reposTable.updatedAt), desc(reposTable.createdAt)).limit(1))[0]
      ?? null;

    const activeAgents = toNumber(agentStats?.activeAgents);
    const pausedAgents = toNumber(agentStats?.pausedAgents);
    const totalBugs = toNumber(agentStats?.totalBugs);
    const totalEscalations = toNumber(agentStats?.totalEscalations);
    const totalTasks = toNumber(agentStats?.totalTasks);
    const totalKbHits = toNumber(agentStats?.totalKbHits);

    const kpis = calculatePhaseOneKpis({
      truePositives: toNumber(agentStats?.truePositives),
      falsePositives: toNumber(agentStats?.falsePositives),
      averageAccuracy: toNumber(agentStats?.averageAccuracy),
      bugFoundEvents: toNumber(eventStats?.bugFoundEvents),
      discardedFindingEvents: toNumber(eventStats?.discardedFindingEvents),
      lowConfidenceEvents: toNumber(eventStats?.lowConfidenceEvents),
      recommendationApproved: toNumber(eventStats?.recommendationApproved),
      recommendationTotal: toNumber(eventStats?.recommendationTotal),
      testProposed: toNumber(eventStats?.testProposed),
      testApproved: toNumber(eventStats?.testApproved),
      resolvedFindings: toNumber(findingStats?.resolvedFindings),
      brierTotal: toNumber(findingStats?.brierTotal),
    });

    const healthScore = repoRow ? Math.max(0, Math.min(100, toNumber(repoRow.healthScore))) : 0;
    const coverageOverall = extractCoverageOverall(repoRow?.layoutData ?? null) ?? 0;

    const cpuUsage = (process.cpuUsage().user / 1000000) % 100;
    const memMb = process.memoryUsage().heapUsed / 1024 / 1024;
    const realReinforcementRows = filterNonSyntheticReinforcementEvents(reinforcementRows);

    const reinforcementAttempts = realReinforcementRows.reduce(
      (total, row) => total + Math.max(0, Math.round(toNumber(row.attempted))),
      0,
    );
    const reinforcementApplied = realReinforcementRows.reduce(
      (total, row) => total + Math.max(0, Math.round(toNumber(row.applied))),
      0,
    );
    const reinforcementBoosts = realReinforcementRows.reduce(
      (total, row) => total + (row.eventType === "phase2_reinforcement_boost" ? 1 : 0),
      0,
    );
    const reinforcementDecays = realReinforcementRows.reduce(
      (total, row) => total + (row.eventType === "phase2_reinforcement_decay" ? 1 : 0),
      0,
    );
    const reinforcementNet = reinforcementBoosts - reinforcementDecays;
    const reinforcementCoverage = reinforcementAttempts > 0
      ? clamp01(reinforcementApplied / reinforcementAttempts)
      : 0;

    await db.insert(metricSnapshotsTable).values({
      healthScore,
      coverageOverall,
      predictionAccuracyScore: kpis.predictionAccuracyScore,
      falseNegativeRate: kpis.falseNegativeRate,
      confidenceCalibrationIndex: kpis.confidenceCalibrationIndex,
      recommendationFixConversion: kpis.recommendationFixConversion,
      testGenerationEffectiveness: kpis.testGenerationEffectiveness,
      kpiSampleSize: kpis.kpiSampleSize,
      reinforcementAttempts,
      reinforcementApplied,
      reinforcementBoosts,
      reinforcementDecays,
      reinforcementNet,
      reinforcementCoverage,
      agingPersonalUpdates: aging.ran ? aging.personalEntriesDecayed : 0,
      agingKnowledgeUpdates: aging.ran ? aging.knowledgeEntriesDecayed : 0,
      activeAgents,
      pausedAgents,
      totalBugs,
      kbHitRate: totalTasks > 0 ? Math.min(1, totalKbHits / totalTasks) : 0,
      tasksCompleted: totalTasks,
      escalationsToday: totalEscalations,
      cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
      memoryMb: memMb,
    });

    const [countRow] = await db.select({ total: count() }).from(metricSnapshotsTable);
    if ((countRow?.total ?? 0) > 1000) {
      const oldOnes = await db.select({ id: metricSnapshotsTable.id })
        .from(metricSnapshotsTable)
        .orderBy(metricSnapshotsTable.timestamp)
        .limit(100);
      for (const old of oldOnes) {
        await db.delete(metricSnapshotsTable).where(sql`id = ${old.id}`);
      }
    }
  } catch { }
}

router.get("/rollout-gates", async (req, res) => {
  try {
    const hours = parseHoursParam(req.query["hours"], 24);
    const since = toIsoHoursAgo(hours);
    const [summary, snapshots] = await Promise.all([
      buildReinforcementSummary(hours),
      db.select({
        timestamp: metricSnapshotsTable.timestamp,
        predictionAccuracyScore: metricSnapshotsTable.predictionAccuracyScore,
        falseNegativeRate: metricSnapshotsTable.falseNegativeRate,
        confidenceCalibrationIndex: metricSnapshotsTable.confidenceCalibrationIndex,
      })
        .from(metricSnapshotsTable)
        .where(gte(metricSnapshotsTable.timestamp, since))
        .orderBy(metricSnapshotsTable.timestamp)
        .limit(1000),
    ]);

    const baseline = snapshots[0];
    const current = snapshots[snapshots.length - 1];

    const pasDelta = baseline && current
      ? round4(toNumber(current.predictionAccuracyScore) - toNumber(baseline.predictionAccuracyScore))
      : 0;
    const fnrDelta = baseline && current
      ? round4(toNumber(current.falseNegativeRate) - toNumber(baseline.falseNegativeRate))
      : 0;
    const cciDelta = baseline && current
      ? round4(toNumber(current.confidenceCalibrationIndex) - toNumber(baseline.confidenceCalibrationIndex))
      : 0;

    const gates = [
      {
        id: "reinforcement_coverage",
        label: "Minimum reinforcement coverage",
        threshold: 0.6,
        value: summary.totals.coverage,
        passed: summary.totals.coverage >= 0.6,
      },
      {
        id: "reinforcement_attempt_volume",
        label: "Minimum reinforcement attempts",
        threshold: 10,
        value: summary.totals.attempts,
        passed: summary.totals.attempts >= 10,
      },
      {
        id: "pas_non_regression",
        label: "PAS non-regression window",
        threshold: -0.01,
        value: pasDelta,
        passed: pasDelta >= -0.01,
      },
      {
        id: "fnr_non_regression",
        label: "FNR non-regression window",
        threshold: 0.02,
        value: fnrDelta,
        passed: fnrDelta <= 0.02,
      },
      {
        id: "cci_non_regression",
        label: "CCI non-regression window",
        threshold: -0.02,
        value: cciDelta,
        passed: cciDelta >= -0.02,
      },
      {
        id: "verification_suite",
        label: "Tests/typecheck/smoke",
        threshold: "manual-check",
        value: "must pass in CI or local validation run",
        passed: null,
      },
    ];

    const autoGatePass = gates
      .filter(gate => typeof gate.passed === "boolean")
      .every(gate => gate.passed === true);

    res.json({
      hours,
      gateVersion: "phase2-rollout-v1",
      baselineTimestamp: baseline?.timestamp ?? null,
      currentTimestamp: current?.timestamp ?? null,
      pasDelta,
      fnrDelta,
      cciDelta,
      smarterPercentEstimate: summary.smarterPercentEstimate,
      gates,
      autoGatePass,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "ROLLOUT_GATES_ERROR", message });
  }
});

export default router;
