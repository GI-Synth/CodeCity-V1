import { db, repairCorruptKnowledgeRow } from "@workspace/db";
import { agentAccuracyTable, knowledgeTable, patternSuppressionsTable, patternWeightsTable } from "@workspace/db/schema";
import { desc, eq, gte } from "drizzle-orm";
import { basename, extname } from "node:path";
import { inferIssueType } from "./findingQuality";
import {
  applyConfirmedFindingToPersonalKb,
  mapRoleToPersona,
  parsePersonalKb,
  patternSimilarity,
  serializePersonalKb,
  toMemoryPattern,
  type PersonalKbEntry,
} from "./smartAgents";
import { invalidateKnowledgeSearchCache } from "./vectorSearch";
import {
  boundReinforcementDelta,
  isEvidenceStrongEnough,
  isReinforcementEnabled,
  shouldSkipReinforcementForCooldown,
} from "./reinforcementTelemetry";

export type ReinforcementVerdict = "true_positive" | "false_positive";

export type PersonalKbReinforcementAction = "boosted" | "degraded" | "none";

export type PersonalKbReinforcementResult = {
  nextPersonalKb: string;
  pattern: string;
  action: PersonalKbReinforcementAction;
  changed: boolean;
};

export type SharedKnowledgeReinforcementResult = {
  issuePattern: string;
  updatedEntries: number;
  insertedEntry: boolean;
  cooldownSkipped: boolean;
  applied: boolean;
  qualityDelta: number;
};

type SharedKnowledgeScanRow = {
  id: number;
  language: string | null;
  problemType: string | null;
  patternTags: string | null;
  question: string | null;
  answer: string | null;
  qualityScore: number | null;
  wasUseful: number | null;
  producedBugs: number | null;
  useCount: number | null;
};

export type ReinforcementCorruptionTelemetry = {
  knownCorruptRowCount: number;
  scanCorruptionSkips: number;
  rowUpdateCorruptionSkips: number;
  seedInsertCorruptionSkips: number;
  suppressedKnownCorruptRowSkips: number;
  repairAttempts: number;
  repairSuccesses: number;
  repairFailures: number;
  lastRepairTimestamp: string | null;
  lastRepairError: string | null;
};

const PERSONAL_KB_MATCH_THRESHOLD = 0.7;
const PERSONAL_KB_NEGATIVE_CONFIDENCE_DELTA = 0.12;
const PERSONAL_KB_MIN_CONFIDENCE = 0.01;
const KNOWLEDGE_SCAN_LIMIT = 260;
const KNOWLEDGE_UPDATE_LIMIT = 12;
const knownCorruptKnowledgeRowIds = new Set<number>();
const corruptionTelemetry: ReinforcementCorruptionTelemetry = {
  knownCorruptRowCount: 0,
  scanCorruptionSkips: 0,
  rowUpdateCorruptionSkips: 0,
  seedInsertCorruptionSkips: 0,
  suppressedKnownCorruptRowSkips: 0,
  repairAttempts: 0,
  repairSuccesses: 0,
  repairFailures: 0,
  lastRepairTimestamp: null,
  lastRepairError: null,
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSqliteCorruptionError(error: unknown): boolean {
  const lower = toErrorMessage(error).toLowerCase();
  return lower.includes("sqlite_corrupt")
    || lower.includes("database disk image is malformed")
    || lower.includes("database corruption");
}

function syncKnownCorruptRowCount(): void {
  corruptionTelemetry.knownCorruptRowCount = knownCorruptKnowledgeRowIds.size;
}

function markKnownCorruptKnowledgeRow(rowId: number): void {
  if (!Number.isFinite(rowId)) return;
  knownCorruptKnowledgeRowIds.add(rowId);
  syncKnownCorruptRowCount();
}

async function attemptCorruptKnowledgeRowRepair(params: {
  rowId: number;
  source: string;
  detail: string;
}): Promise<void> {
  if (!Number.isFinite(params.rowId)) return;

  corruptionTelemetry.repairAttempts += 1;
  corruptionTelemetry.lastRepairTimestamp = new Date().toISOString();

  try {
    const repairResult = await repairCorruptKnowledgeRow({
      rowId: params.rowId,
      source: params.source,
      detail: params.detail,
    });

    if (repairResult.success) {
      corruptionTelemetry.repairSuccesses += 1;
    } else {
      corruptionTelemetry.repairFailures += 1;
    }

    corruptionTelemetry.lastRepairError = repairResult.error ?? null;
  } catch (error) {
    corruptionTelemetry.repairFailures += 1;
    corruptionTelemetry.lastRepairError = toErrorMessage(error);
  }
}

export function getReinforcementCorruptionTelemetry(): ReinforcementCorruptionTelemetry {
  syncKnownCorruptRowCount();
  return {
    ...corruptionTelemetry,
  };
}

export function resetReinforcementCorruptionTelemetry(): void {
  knownCorruptKnowledgeRowIds.clear();
  corruptionTelemetry.knownCorruptRowCount = 0;
  corruptionTelemetry.scanCorruptionSkips = 0;
  corruptionTelemetry.rowUpdateCorruptionSkips = 0;
  corruptionTelemetry.seedInsertCorruptionSkips = 0;
  corruptionTelemetry.suppressedKnownCorruptRowSkips = 0;
  corruptionTelemetry.repairAttempts = 0;
  corruptionTelemetry.repairSuccesses = 0;
  corruptionTelemetry.repairFailures = 0;
  corruptionTelemetry.lastRepairTimestamp = null;
  corruptionTelemetry.lastRepairError = null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}

function detectFileType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext) return ext;
  return basename(filePath).toLowerCase() || "unknown";
}

function compactText(text: string, max = 180): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function tokenizePattern(pattern: string): string[] {
  return pattern
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .slice(0, 8);
}

function findBestPersonalKbMatch(entries: PersonalKbEntry[], pattern: string): { index: number; score: number } | null {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const score = patternSimilarity(pattern, entries[i]?.pattern ?? "");
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < PERSONAL_KB_MATCH_THRESHOLD) return null;
  return { index: bestIndex, score: bestScore };
}

export function normalizeIssuePattern(issueType: string): string {
  return issueType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "general";
}

function degradePersonalKbEntry(entries: PersonalKbEntry[], index: number): PersonalKbEntry[] {
  const next = [...entries];
  const current = next[index];
  if (!current) return entries;

  const nowIso = new Date().toISOString();
  const decayDelta = Math.abs(boundReinforcementDelta(-PERSONAL_KB_NEGATIVE_CONFIDENCE_DELTA));
  const nextConfidence = Math.max(PERSONAL_KB_MIN_CONFIDENCE, clamp01(current.confidence) - decayDelta);
  const currentConfirmed = Math.max(0, Number(current.confirmedCount ?? current.timesFound ?? 0));
  const nextConfirmed = Math.max(0, currentConfirmed - 1);
  const nextTimesFound = Math.max(1, Math.max(1, Number(current.timesFound ?? 1)) - 1);

  if (nextConfidence <= 0.12 && nextConfirmed === 0) {
    next.splice(index, 1);
    return next;
  }

  next[index] = {
    ...current,
    confidence: nextConfidence,
    confirmedCount: nextConfirmed,
    timesFound: nextTimesFound,
    updatedAt: nowIso,
  };

  return next;
}

export function applyVerdictToPersonalKb(params: {
  rawPersonalKb: string | null | undefined;
  role: string;
  filePath: string;
  findingText: string;
  functionName?: string | null;
  fileType?: string | null;
  language?: string | null;
  confidence?: number | null;
  verdict: ReinforcementVerdict;
}): PersonalKbReinforcementResult {
  if (!isReinforcementEnabled() || !isEvidenceStrongEnough(params.confidence ?? null)) {
    return {
      nextPersonalKb: serializePersonalKb(parsePersonalKb(params.rawPersonalKb)),
      pattern: "",
      action: "none",
      changed: false,
    };
  }

  const normalizedPath = normalizePath(params.filePath);
  const persona = mapRoleToPersona(params.role);
  const pattern = toMemoryPattern({
    persona,
    filePath: normalizedPath,
    finding: params.findingText,
    functionName: params.functionName ?? null,
  });

  const entries = parsePersonalKb(params.rawPersonalKb);

  if (params.verdict === "true_positive") {
    const updatedEntries = applyConfirmedFindingToPersonalKb({
      entries,
      pattern,
      fileType: params.fileType ?? detectFileType(normalizedPath),
      language: params.language?.trim() || "unknown",
      confidence: clamp01(params.confidence ?? 0.75),
    });

    return {
      nextPersonalKb: serializePersonalKb(updatedEntries),
      pattern,
      action: "boosted",
      changed: true,
    };
  }

  const match = findBestPersonalKbMatch(entries, pattern);
  if (!match) {
    return {
      nextPersonalKb: serializePersonalKb(entries),
      pattern,
      action: "none",
      changed: false,
    };
  }

  const degraded = degradePersonalKbEntry(entries, match.index);

  return {
    nextPersonalKb: serializePersonalKb(degraded),
    pattern,
    action: "degraded",
    changed: true,
  };
}

export function computeReinforcedKnowledgeUpdate(params: {
  verdict: ReinforcementVerdict;
  qualityScore: number;
  wasUseful: number;
  producedBugs: number;
  useCount: number;
}): { qualityScore: number; wasUseful: number; producedBugs: number; useCount: number } {
  const qualityScore = clamp01(params.qualityScore);
  const wasUseful = Math.max(0, Math.round(params.wasUseful));
  const producedBugs = Math.max(0, Math.round(params.producedBugs));
  const useCount = Math.max(1, Math.round(params.useCount));
  const positiveQualityDelta = Math.abs(boundReinforcementDelta(0.08));
  const negativeQualityDelta = Math.abs(boundReinforcementDelta(-0.12));

  if (params.verdict === "true_positive") {
    return {
      qualityScore: clamp01(qualityScore + positiveQualityDelta),
      wasUseful: wasUseful + 1,
      producedBugs: producedBugs + 1,
      useCount: useCount + 1,
    };
  }

  return {
    qualityScore: clamp01(qualityScore - negativeQualityDelta),
    wasUseful: Math.max(0, wasUseful - 1),
    producedBugs: Math.max(0, producedBugs - 1),
    useCount: useCount + 1,
  };
}

function scoreKnowledgeMatch(params: {
  rowText: string;
  issuePattern: string;
  fileToken: string;
  patternTokens: string[];
}): number {
  let score = 0;

  if (params.rowText.includes(params.issuePattern)) score += 4;
  if (params.fileToken.length > 0 && params.rowText.includes(params.fileToken)) score += 2;

  for (const token of params.patternTokens) {
    if (params.rowText.includes(token)) score += 1;
  }

  return score;
}

function buildFallbackKnowledgeSeed(params: {
  issuePattern: string;
  filePath: string;
  findingText: string;
  language: string;
  sourceTag: string;
}): Omit<typeof knowledgeTable.$inferInsert, "id" | "createdAt"> {
  const normalizedPath = normalizePath(params.filePath);
  const text = compactText(params.findingText, 260);
  const now = Date.now();

  return {
    problemType: `reinforced_${params.issuePattern}`,
    language: params.language || "general",
    fileType: detectFileType(normalizedPath),
    patternTags: `phase2,reinforced,${params.sourceTag},${params.issuePattern},true_positive`,
    question: `Verified ${params.issuePattern} pattern in ${normalizedPath}`,
    contextHash: `phase2:reinforced:${params.sourceTag}:${params.issuePattern}:${now}`,
    codeSnippet: text,
    answer: `Human verdict confirmed this bug pattern. Prioritize similar findings for ${normalizedPath}.`,
    actionItems: JSON.stringify([
      "Increase confidence when this pattern appears with similar evidence.",
      "Generate tests that lock this regression.",
    ]),
    confidence: "0.9",
    provider: "phase2-reinforcement",
    domain: params.language === "typescript" || params.language === "javascript" ? "general" : params.language,
    embedding: null,
    useCount: 1,
    wasUseful: 1,
    producedBugs: 1,
    qualityScore: 0.82,
    lastUsed: null,
    framework: null,
  };
}

export async function reinforceSharedKnowledgeFromVerdict(params: {
  verdict: ReinforcementVerdict;
  filePath: string;
  findingText: string;
  issueType?: string | null;
  language?: string | null;
  confidence?: number | null;
  source: string;
}): Promise<SharedKnowledgeReinforcementResult> {
  const normalizedPath = normalizePath(params.filePath);
  const normalizedLanguage = (params.language ?? "").trim().toLowerCase();
  const issuePattern = normalizeIssuePattern(params.issueType ?? inferIssueType(params.findingText));

  if (!isReinforcementEnabled() || !isEvidenceStrongEnough(params.confidence ?? null)) {
    return {
      issuePattern,
      updatedEntries: 0,
      insertedEntry: false,
      cooldownSkipped: false,
      applied: false,
      qualityDelta: 0,
    };
  }

  const cooldownSkipped = await shouldSkipReinforcementForCooldown(issuePattern);
  if (cooldownSkipped) {
    return {
      issuePattern,
      updatedEntries: 0,
      insertedEntry: false,
      cooldownSkipped: true,
      applied: false,
      qualityDelta: 0,
    };
  }

  const sourceTag = params.source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "phase2";
  const fileToken = basename(normalizedPath).toLowerCase();
  const patternTokens = tokenizePattern(issuePattern);

  let rows: SharedKnowledgeScanRow[] = [];
  try {
    rows = await db
      .select({
        id: knowledgeTable.id,
        language: knowledgeTable.language,
        problemType: knowledgeTable.problemType,
        patternTags: knowledgeTable.patternTags,
        question: knowledgeTable.question,
        answer: knowledgeTable.answer,
        qualityScore: knowledgeTable.qualityScore,
        wasUseful: knowledgeTable.wasUseful,
        producedBugs: knowledgeTable.producedBugs,
        useCount: knowledgeTable.useCount,
      })
      .from(knowledgeTable)
      .orderBy(desc(knowledgeTable.id))
      .limit(KNOWLEDGE_SCAN_LIMIT);
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    corruptionTelemetry.scanCorruptionSkips += 1;
    console.warn(`[Phase2] shared-knowledge scan skipped due SQLite corruption: ${toErrorMessage(error)}`);
  }

  const scoredCandidates = rows
    .filter((row) => {
      if (!normalizedLanguage || normalizedLanguage === "unknown") return true;
      const rowLanguage = (row.language ?? "").trim().toLowerCase();
      return rowLanguage === normalizedLanguage || rowLanguage === "general" || rowLanguage === "meta";
    })
    .map((row) => {
      const rowText = `${row.problemType ?? ""} ${row.patternTags ?? ""} ${row.question ?? ""} ${row.answer ?? ""}`.toLowerCase();
      const score = scoreKnowledgeMatch({
        rowText,
        issuePattern,
        fileToken,
        patternTokens,
      });
      return { row, score };
    })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);

  const scored: typeof scoredCandidates = [];
  for (const candidate of scoredCandidates) {
    const rowId = Number(candidate.row.id);
    if (Number.isFinite(rowId) && knownCorruptKnowledgeRowIds.has(rowId)) {
      corruptionTelemetry.suppressedKnownCorruptRowSkips += 1;
      continue;
    }

    scored.push(candidate);
    if (scored.length >= KNOWLEDGE_UPDATE_LIMIT) break;
  }

  let updatedEntries = 0;
  let totalQualityDelta = 0;

  for (const { row } of scored) {
    const next = computeReinforcedKnowledgeUpdate({
      verdict: params.verdict,
      qualityScore: Number(row.qualityScore ?? 0.5),
      wasUseful: Number(row.wasUseful ?? 0),
      producedBugs: Number(row.producedBugs ?? 0),
      useCount: Number(row.useCount ?? 1),
    });

    try {
      await db.update(knowledgeTable).set({
        qualityScore: next.qualityScore,
        wasUseful: next.wasUseful,
        producedBugs: next.producedBugs,
        useCount: next.useCount,
        lastUsed: new Date().toISOString(),
      }).where(eq(knowledgeTable.id, row.id));

      totalQualityDelta += next.qualityScore - Number(row.qualityScore ?? 0.5);
      updatedEntries += 1;
    } catch (error) {
      if (!isSqliteCorruptionError(error)) throw error;
      corruptionTelemetry.rowUpdateCorruptionSkips += 1;
      const rowId = Number(row.id);
      if (Number.isFinite(rowId)) {
        markKnownCorruptKnowledgeRow(rowId);
        await attemptCorruptKnowledgeRowRepair({
          rowId,
          source: "phase2-shared-knowledge-update",
          detail: `issuePattern=${issuePattern};verdict=${params.verdict};source=${sourceTag}`,
        });
      }
      console.warn(`[Phase2] skipping corrupt shared-knowledge row id=${row.id}: ${toErrorMessage(error)}`);
    }
  }

  let insertedEntry = false;
  if (updatedEntries === 0 && params.verdict === "true_positive") {
    try {
      await db.insert(knowledgeTable).values(buildFallbackKnowledgeSeed({
        issuePattern,
        filePath: normalizedPath,
        findingText: params.findingText,
        language: normalizedLanguage || "general",
        sourceTag,
      }));
      insertedEntry = true;
      totalQualityDelta += Math.abs(boundReinforcementDelta(0.08));
    } catch (error) {
      if (!isSqliteCorruptionError(error)) throw error;
      corruptionTelemetry.seedInsertCorruptionSkips += 1;
      console.warn(`[Phase2] fallback shared-knowledge seed skipped due SQLite corruption: ${toErrorMessage(error)}`);
    }
  }

  if (updatedEntries > 0 || insertedEntry) {
    invalidateKnowledgeSearchCache();
  }

  return {
    issuePattern,
    updatedEntries,
    insertedEntry,
    cooldownSkipped: false,
    applied: updatedEntries > 0 || insertedEntry,
    qualityDelta: round4(totalQualityDelta),
  };
}

// ── Part 7: Self-Improvement Loop ────────────────────────────────────────────

/**
 * Update the agent accuracy score based on a verdict.
 * Uses the agent_accuracy table to track per-role performance.
 */
export async function updateAgentAccuracy(
  agentRole: string,
  verdict: ReinforcementVerdict,
): Promise<{ accuracy: number }> {
  const [existing] = await db
    .select()
    .from(agentAccuracyTable)
    .where(eq(agentAccuracyTable.agentRole, agentRole))
    .limit(1);

  if (!existing) {
    const tp = verdict === "true_positive" ? 1 : 0;
    const fp = verdict === "false_positive" ? 1 : 0;
    const accuracy = tp / (tp + fp);
    await db.insert(agentAccuracyTable).values({
      agentRole,
      totalFindings: 1,
      truePositives: tp,
      falsePositives: fp,
      accuracyScore: accuracy,
      lastUpdated: new Date().toISOString(),
    });
    return { accuracy };
  }

  const tp = existing.truePositives + (verdict === "true_positive" ? 1 : 0);
  const fp = existing.falsePositives + (verdict === "false_positive" ? 1 : 0);
  const total = existing.totalFindings + 1;
  const accuracy = total > 0 ? clamp01(tp / total) : 0.5;

  await db
    .update(agentAccuracyTable)
    .set({
      totalFindings: total,
      truePositives: tp,
      falsePositives: fp,
      accuracyScore: round4(accuracy),
      lastUpdated: new Date().toISOString(),
    })
    .where(eq(agentAccuracyTable.agentRole, agentRole));

  return { accuracy };
}

/** Get the accuracy score for an agent role. */
export async function getAgentAccuracy(agentRole: string): Promise<number> {
  const [row] = await db
    .select({ accuracyScore: agentAccuracyTable.accuracyScore })
    .from(agentAccuracyTable)
    .where(eq(agentAccuracyTable.agentRole, agentRole))
    .limit(1);
  return row?.accuracyScore ?? 0.8;
}

/** Get accuracy scores for all agents. */
export async function getAllAgentAccuracies(): Promise<{ agentRole: string; accuracy: number; total: number }[]> {
  const rows = await db.select().from(agentAccuracyTable);
  return rows.map(r => ({
    agentRole: r.agentRole,
    accuracy: r.accuracyScore,
    total: r.totalFindings,
  }));
}

/**
 * Adjust a pattern's weight based on verdict.
 * Accepted findings boost weight (+1), rejected findings decay (-1).
 */
export async function adjustPatternWeight(
  patternId: string,
  verdict: ReinforcementVerdict,
  projectId = "default",
): Promise<{ weight: number }> {
  const [existing] = await db
    .select()
    .from(patternWeightsTable)
    .where(eq(patternWeightsTable.patternId, patternId))
    .limit(1);

  if (!existing) {
    const weight = verdict === "true_positive" ? 1.1 : 0.9;
    await db.insert(patternWeightsTable).values({
      patternId,
      projectId,
      weight,
      boostCount: verdict === "true_positive" ? 1 : 0,
      decayCount: verdict === "false_positive" ? 1 : 0,
      lastUpdated: new Date().toISOString(),
    });
    return { weight };
  }

  const boost = verdict === "true_positive" ? 1 : 0;
  const decay = verdict === "false_positive" ? 1 : 0;
  const nextBoost = existing.boostCount + boost;
  const nextDecay = existing.decayCount + decay;
  // Weight formula: base 1.0 + 0.05 per boost - 0.1 per decay, clamped [0.1, 3.0]
  const weight = Math.max(0.1, Math.min(3.0, 1.0 + 0.05 * nextBoost - 0.1 * nextDecay));

  await db
    .update(patternWeightsTable)
    .set({
      weight: round4(weight),
      boostCount: nextBoost,
      decayCount: nextDecay,
      lastUpdated: new Date().toISOString(),
    })
    .where(eq(patternWeightsTable.patternId, patternId));

  return { weight };
}

/** Get the weight for a pattern (defaults to 1.0 if unknown). */
export async function getPatternWeight(patternId: string): Promise<number> {
  const [row] = await db
    .select({ weight: patternWeightsTable.weight })
    .from(patternWeightsTable)
    .where(eq(patternWeightsTable.patternId, patternId))
    .limit(1);
  return row?.weight ?? 1.0;
}

/**
 * Suppress a pattern for the given file (or globally) for a duration.
 * This prevents rejected patterns from being re-reported.
 */
export async function suppressPattern(params: {
  patternId: string;
  filePath?: string | null;
  durationMs?: number;
  reason?: string;
}): Promise<void> {
  const durationMs = params.durationMs ?? 24 * 60 * 60 * 1000; // default 24h
  const suppressedUntil = new Date(Date.now() + durationMs).toISOString();
  await db.insert(patternSuppressionsTable).values({
    patternId: params.patternId,
    filePath: params.filePath ?? null,
    suppressedUntil,
    reason: params.reason ?? null,
  });
}

/** Check if a pattern is currently suppressed for a given file. */
export async function isPatternSuppressed(patternId: string, filePath?: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await db
    .select({ id: patternSuppressionsTable.id })
    .from(patternSuppressionsTable)
    .where(eq(patternSuppressionsTable.patternId, patternId))
    .limit(5);

  for (const _ of rows) {
    // Check if any active suppression matches
    const active = await db
      .select()
      .from(patternSuppressionsTable)
      .where(eq(patternSuppressionsTable.patternId, patternId))
      .limit(5);

    for (const sup of active) {
      if (sup.suppressedUntil > now) {
        // Global suppression or matching file
        if (!sup.filePath || sup.filePath === filePath) return true;
      }
    }
    break;
  }
  return false;
}

/**
 * Full self-improvement cycle for a verdict.
 * Combines agent accuracy update, pattern weight adjustment,
 * personal KB update, shared KB update, and pattern suppression.
 */
export async function runSelfImprovementCycle(params: {
  agentRole: string;
  rawPersonalKb: string | null | undefined;
  filePath: string;
  findingText: string;
  functionName?: string | null;
  fileType?: string | null;
  language?: string | null;
  confidence?: number | null;
  issueType?: string | null;
  verdict: ReinforcementVerdict;
  source: string;
}): Promise<{
  accuracy: number;
  patternWeight: number;
  personalKbResult: PersonalKbReinforcementResult;
  sharedKbResult: SharedKnowledgeReinforcementResult;
  suppressed: boolean;
}> {
  const issuePattern = normalizeIssuePattern(params.issueType ?? inferIssueType(params.findingText));

  // 1. Update agent accuracy score
  const { accuracy } = await updateAgentAccuracy(params.agentRole, params.verdict);

  // 2. Adjust pattern weight
  const { weight: patternWeight } = await adjustPatternWeight(issuePattern, params.verdict);

  // 3. Update personal KB
  const personalKbResult = applyVerdictToPersonalKb({
    rawPersonalKb: params.rawPersonalKb,
    role: params.agentRole,
    filePath: params.filePath,
    findingText: params.findingText,
    functionName: params.functionName,
    fileType: params.fileType,
    language: params.language,
    confidence: params.confidence,
    verdict: params.verdict,
  });

  // 4. Update shared KB
  const sharedKbResult = await reinforceSharedKnowledgeFromVerdict({
    verdict: params.verdict,
    filePath: params.filePath,
    findingText: params.findingText,
    issueType: params.issueType,
    language: params.language,
    confidence: params.confidence,
    source: params.source,
  });

  // 5. If rejected, suppress pattern for this file for 24h
  let suppressed = false;
  if (params.verdict === "false_positive") {
    await suppressPattern({
      patternId: issuePattern,
      filePath: params.filePath,
      durationMs: 24 * 60 * 60 * 1000,
      reason: `Rejected by user verdict from ${params.source}`,
    });
    suppressed = true;
  }

  return { accuracy, patternWeight, personalKbResult, sharedKbResult, suppressed };
}
