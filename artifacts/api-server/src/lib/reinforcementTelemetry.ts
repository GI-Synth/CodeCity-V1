import { db } from "@workspace/db";
import { agentsTable, eventsTable, knowledgeTable, reinforcementEventsTable } from "@workspace/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { parsePersonalKb, serializePersonalKb, type PersonalKbEntry } from "./smartAgents";

export type ReinforcementEventType = "phase2_reinforcement_boost" | "phase2_reinforcement_decay";

export type ReinforcementControls = {
  enabled: boolean;
  perEventMaxDelta: number;
  patternCooldownMinutes: number;
  minEvidenceConfidence: number;
  personalKbStaleDays: number;
  personalKbStaleDecay: number;
  knowledgeStaleDays: number;
  knowledgeStaleDecay: number;
  maxAgingUpdatesPerRun: number;
};

export type ReinforcementTelemetryInput = {
  eventType: ReinforcementEventType;
  source: string;
  verdict: "true_positive" | "false_positive";
  verdictOrigin?: string | null;
  issuePattern: string;
  filePath?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  agentRole?: string | null;
  findingId?: string | number | null;
  linkedContext?: string | null;
  personalKbAction?: "boosted" | "degraded" | "none";
  personalKbChanged?: boolean;
  sharedKnowledgeUpdated?: number;
  sharedKnowledgeSeeded?: boolean;
  qualityDelta?: number;
  confidenceDelta?: number;
  attempted?: boolean;
  applied?: boolean;
  cooldownSkipped?: boolean;
  evidenceScore?: number;
};

export type ReinforcementAgingResult = {
  ran: boolean;
  personalEntriesDecayed: number;
  knowledgeEntriesDecayed: number;
  skippedReason?: "disabled" | "interval";
};

const AGING_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_CONTROLS: ReinforcementControls = {
  enabled: normalizeBoolean(process.env["PHASE2_REINFORCEMENT_ENABLED"], true),
  perEventMaxDelta: normalizeNumber(process.env["PHASE2_REINFORCEMENT_MAX_DELTA"], 0.12, 0.02, 0.5),
  patternCooldownMinutes: normalizeInteger(process.env["PHASE2_PATTERN_COOLDOWN_MINUTES"], 5, 0, 240),
  minEvidenceConfidence: normalizeNumber(process.env["PHASE2_MIN_EVIDENCE_CONFIDENCE"], 0.25, 0, 1),
  personalKbStaleDays: normalizeInteger(process.env["PHASE2_PERSONAL_KB_STALE_DAYS"], 14, 1, 365),
  personalKbStaleDecay: normalizeNumber(process.env["PHASE2_PERSONAL_KB_STALE_DECAY"], 0.04, 0.005, 0.5),
  knowledgeStaleDays: normalizeInteger(process.env["PHASE2_SHARED_KB_STALE_DAYS"], 21, 1, 365),
  knowledgeStaleDecay: normalizeNumber(process.env["PHASE2_SHARED_KB_STALE_DECAY"], 0.05, 0.005, 0.5),
  maxAgingUpdatesPerRun: normalizeInteger(process.env["PHASE2_AGING_MAX_UPDATES"], 50, 1, 500),
};

let runtimeControls: ReinforcementControls = { ...DEFAULT_CONTROLS };
let lastAgingRunAtMs = 0;

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const rounded = Math.round(normalizeNumber(value, fallback, min, max));
  return Math.max(min, Math.min(max, rounded));
}

function parseTimestampMs(raw: string | null | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampDelta(value: number): number {
  const maxDelta = getReinforcementControls().perEventMaxDelta;
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  return Math.max(-maxDelta, Math.min(maxDelta, value));
}

function formatLineage(input: ReinforcementTelemetryInput): string {
  const pieces = [
    `source=${input.source}`,
    `origin=${input.verdictOrigin ?? input.source}`,
    `pattern=${input.issuePattern}`,
  ];

  if (input.findingId !== undefined && input.findingId !== null) {
    pieces.push(`finding=${String(input.findingId)}`);
  }

  if (input.linkedContext) {
    pieces.push(`ctx=${input.linkedContext}`);
  }

  return pieces.join(" ");
}

function buildEventMessage(input: ReinforcementTelemetryInput): string {
  const verb = input.eventType === "phase2_reinforcement_boost" ? "boost" : "decay";
  const target = input.filePath ? ` ${input.filePath}` : "";
  const lineage = formatLineage(input);
  const cooldown = input.cooldownSkipped ? " cooldown-skip" : "";
  const applied = (input.applied ?? false) ? " applied" : " observed";
  return `[phase2] ${verb}${target} (${applied}${cooldown}) ${lineage}`;
}

function sanitizeControls(input: Partial<ReinforcementControls>): ReinforcementControls {
  return {
    enabled: input.enabled ?? runtimeControls.enabled,
    perEventMaxDelta: normalizeNumber(input.perEventMaxDelta, runtimeControls.perEventMaxDelta, 0.02, 0.5),
    patternCooldownMinutes: normalizeInteger(input.patternCooldownMinutes, runtimeControls.patternCooldownMinutes, 0, 240),
    minEvidenceConfidence: normalizeNumber(input.minEvidenceConfidence, runtimeControls.minEvidenceConfidence, 0, 1),
    personalKbStaleDays: normalizeInteger(input.personalKbStaleDays, runtimeControls.personalKbStaleDays, 1, 365),
    personalKbStaleDecay: normalizeNumber(input.personalKbStaleDecay, runtimeControls.personalKbStaleDecay, 0.005, 0.5),
    knowledgeStaleDays: normalizeInteger(input.knowledgeStaleDays, runtimeControls.knowledgeStaleDays, 1, 365),
    knowledgeStaleDecay: normalizeNumber(input.knowledgeStaleDecay, runtimeControls.knowledgeStaleDecay, 0.005, 0.5),
    maxAgingUpdatesPerRun: normalizeInteger(input.maxAgingUpdatesPerRun, runtimeControls.maxAgingUpdatesPerRun, 1, 500),
  };
}

function decayPersonalEntry(entry: PersonalKbEntry, decayDelta: number, nowIso: string): PersonalKbEntry | null {
  const currentConfidence = clamp01(Number(entry.confidence ?? 0));
  const nextConfidence = clamp01(currentConfidence - decayDelta);
  const currentConfirmed = Math.max(0, Number(entry.confirmedCount ?? entry.timesFound ?? 0));
  const nextConfirmed = Math.max(0, currentConfirmed - 1);
  const nextTimesFound = Math.max(1, Math.max(1, Number(entry.timesFound ?? 1)) - 1);

  if (nextConfidence <= 0.08 && nextConfirmed === 0) return null;

  return {
    ...entry,
    confidence: nextConfidence,
    confirmedCount: nextConfirmed,
    timesFound: nextTimesFound,
    updatedAt: nowIso,
  };
}

export function getReinforcementControls(): ReinforcementControls {
  return { ...runtimeControls };
}

export function updateReinforcementControls(patch: Partial<ReinforcementControls>): ReinforcementControls {
  runtimeControls = sanitizeControls(patch);
  return getReinforcementControls();
}

export function resetReinforcementControls(): ReinforcementControls {
  runtimeControls = { ...DEFAULT_CONTROLS };
  return getReinforcementControls();
}

export function isReinforcementEnabled(): boolean {
  return runtimeControls.enabled;
}

export function isEvidenceStrongEnough(confidence: number | null | undefined): boolean {
  if (confidence === null || confidence === undefined) return true;
  return clamp01(confidence) >= runtimeControls.minEvidenceConfidence;
}

export function boundReinforcementDelta(value: number): number {
  return clampDelta(value);
}

export async function shouldSkipReinforcementForCooldown(issuePattern: string): Promise<boolean> {
  const cooldownMinutes = getReinforcementControls().patternCooldownMinutes;
  if (cooldownMinutes <= 0) return false;

  const rows = await db
    .select({ timestamp: reinforcementEventsTable.timestamp })
    .from(reinforcementEventsTable)
    .where(and(
      eq(reinforcementEventsTable.issuePattern, issuePattern),
      eq(reinforcementEventsTable.applied, 1),
    ))
    .orderBy(desc(reinforcementEventsTable.id))
    .limit(1)
    .catch(() => []);

  const lastAtMs = parseTimestampMs(rows[0]?.timestamp ?? null);
  if (lastAtMs === null) return false;

  const elapsedMs = Date.now() - lastAtMs;
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

export async function recordReinforcementEvent(input: ReinforcementTelemetryInput): Promise<void> {
  const applied = input.applied
    ?? ((input.personalKbChanged ?? false)
      || (Number(input.sharedKnowledgeUpdated ?? 0) > 0)
      || Boolean(input.sharedKnowledgeSeeded));

  await db.insert(reinforcementEventsTable).values({
    eventType: input.eventType,
    source: input.source,
    verdict: input.verdict,
    verdictOrigin: input.verdictOrigin ?? null,
    issuePattern: input.issuePattern,
    filePath: input.filePath ?? null,
    agentId: input.agentId ?? null,
    agentName: input.agentName ?? null,
    agentRole: input.agentRole ?? null,
    findingId: input.findingId === null || input.findingId === undefined ? null : String(input.findingId),
    linkedContext: input.linkedContext ?? null,
    personalKbAction: input.personalKbAction ?? "none",
    personalKbChanged: input.personalKbChanged ? 1 : 0,
    sharedKnowledgeUpdated: Math.max(0, Math.round(Number(input.sharedKnowledgeUpdated ?? 0))),
    sharedKnowledgeSeeded: input.sharedKnowledgeSeeded ? 1 : 0,
    qualityDelta: clampDelta(Number(input.qualityDelta ?? 0)),
    confidenceDelta: clampDelta(Number(input.confidenceDelta ?? 0)),
    attempted: input.attempted === false ? 0 : 1,
    applied: applied ? 1 : 0,
    cooldownSkipped: input.cooldownSkipped ? 1 : 0,
    evidenceScore: clamp01(Number(input.evidenceScore ?? 0)),
  }).catch(() => {});

  await db.insert(eventsTable).values({
    id: `evt-phase2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.eventType,
    agentId: input.agentId ?? null,
    agentName: input.agentName ?? null,
    buildingId: null,
    buildingName: input.filePath ? input.filePath.split("/").pop() ?? null : null,
    message: buildEventMessage({ ...input, applied }),
    severity: input.eventType === "phase2_reinforcement_boost" ? "info" : "warning",
    filePath: input.filePath ?? null,
    issueType: input.issuePattern,
    confidence: input.evidenceScore ?? null,
    codeReference: input.linkedContext ?? null,
  }).catch(() => {});
}

export async function runReinforcementAgingIfDue(): Promise<ReinforcementAgingResult> {
  if (!isReinforcementEnabled()) {
    return { ran: false, personalEntriesDecayed: 0, knowledgeEntriesDecayed: 0, skippedReason: "disabled" };
  }

  const nowMs = Date.now();
  if (nowMs - lastAgingRunAtMs < AGING_INTERVAL_MS) {
    return { ran: false, personalEntriesDecayed: 0, knowledgeEntriesDecayed: 0, skippedReason: "interval" };
  }

  lastAgingRunAtMs = nowMs;
  const nowIso = new Date(nowMs).toISOString();
  const controls = getReinforcementControls();

  let personalEntriesDecayed = 0;
  let knowledgeEntriesDecayed = 0;

  const personalCutoffMs = nowMs - controls.personalKbStaleDays * 24 * 60 * 60 * 1000;
  const agents = await db.select({
    id: agentsTable.id,
    name: agentsTable.name,
    role: agentsTable.role,
    personalKB: agentsTable.personalKB,
  }).from(agentsTable);

  for (const agent of agents) {
    if (personalEntriesDecayed >= controls.maxAgingUpdatesPerRun) break;

    const entries = parsePersonalKb(agent.personalKB);
    if (entries.length === 0) continue;

    let changed = false;
    const nextEntries: PersonalKbEntry[] = [];

    for (const entry of entries) {
      if (personalEntriesDecayed >= controls.maxAgingUpdatesPerRun) {
        nextEntries.push(entry);
        continue;
      }

      const updatedAtMs = parseTimestampMs(entry.updatedAt) ?? 0;
      if (updatedAtMs > personalCutoffMs) {
        nextEntries.push(entry);
        continue;
      }

      const decayed = decayPersonalEntry(entry, controls.personalKbStaleDecay, nowIso);
      personalEntriesDecayed += 1;
      changed = true;

      if (decayed) {
        nextEntries.push(decayed);
      }
    }

    if (!changed) continue;

    await db.update(agentsTable).set({
      personalKB: serializePersonalKb(nextEntries),
    }).where(eq(agentsTable.id, agent.id));

    await recordReinforcementEvent({
      eventType: "phase2_reinforcement_decay",
      source: "aging-policy",
      verdict: "false_positive",
      verdictOrigin: "aging",
      issuePattern: "stale_personal_memory",
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      personalKbAction: "degraded",
      personalKbChanged: true,
      qualityDelta: -controls.personalKbStaleDecay,
      confidenceDelta: -controls.personalKbStaleDecay,
      attempted: true,
      applied: true,
      evidenceScore: 0.5,
    });
  }

  const knowledgeCutoffMs = nowMs - controls.knowledgeStaleDays * 24 * 60 * 60 * 1000;
  const knowledgeRows = await db
    .select({
      id: knowledgeTable.id,
      qualityScore: knowledgeTable.qualityScore,
      wasUseful: knowledgeTable.wasUseful,
      producedBugs: knowledgeTable.producedBugs,
      useCount: knowledgeTable.useCount,
      lastUsed: knowledgeTable.lastUsed,
      createdAt: knowledgeTable.createdAt,
      language: knowledgeTable.language,
      problemType: knowledgeTable.problemType,
    })
    .from(knowledgeTable)
    .orderBy(asc(knowledgeTable.lastUsed), asc(knowledgeTable.createdAt))
    .limit(controls.maxAgingUpdatesPerRun * 4)
    .catch(() => []);

  for (const row of knowledgeRows) {
    if (knowledgeEntriesDecayed >= controls.maxAgingUpdatesPerRun) break;

    const qualityScore = clamp01(Number(row.qualityScore ?? 0));
    if (qualityScore > 0.55) continue;

    const touchedAtMs = parseTimestampMs(row.lastUsed) ?? parseTimestampMs(row.createdAt) ?? nowMs;
    if (touchedAtMs > knowledgeCutoffMs) continue;

    const nextQuality = clamp01(qualityScore - controls.knowledgeStaleDecay);

    await db.update(knowledgeTable).set({
      qualityScore: nextQuality,
      wasUseful: Math.max(0, Number(row.wasUseful ?? 0) - 1),
      producedBugs: Math.max(0, Number(row.producedBugs ?? 0) - 1),
      useCount: Math.max(1, Number(row.useCount ?? 1)),
      lastUsed: nowIso,
    }).where(eq(knowledgeTable.id, row.id));

    knowledgeEntriesDecayed += 1;

    await recordReinforcementEvent({
      eventType: "phase2_reinforcement_decay",
      source: "aging-policy",
      verdict: "false_positive",
      verdictOrigin: "aging",
      issuePattern: "stale_shared_knowledge",
      filePath: null,
      agentId: null,
      agentName: row.language,
      agentRole: "knowledge",
      findingId: row.id,
      linkedContext: row.problemType,
      personalKbAction: "none",
      personalKbChanged: false,
      sharedKnowledgeUpdated: 1,
      sharedKnowledgeSeeded: false,
      qualityDelta: -controls.knowledgeStaleDecay,
      confidenceDelta: 0,
      attempted: true,
      applied: true,
      evidenceScore: qualityScore,
    });
  }

  return {
    ran: true,
    personalEntriesDecayed,
    knowledgeEntriesDecayed,
  };
}
