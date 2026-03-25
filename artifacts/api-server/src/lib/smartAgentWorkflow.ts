import { db } from "@workspace/db";
import { agentsTable, findingsTable, knowledgeTable } from "@workspace/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAlchemistCommand } from "./alchemistExecutor";
import { fileWatcher } from "./fileWatcher";
import { escalate, type EscalationResult } from "./escalationEngine";
import type { Building } from "./types";
import { assessFindingCandidate, recordFindingPipelineAttempt } from "./findingQuality";
import {
  calibrateConfidence,
  extractFileType,
  findSimilarPersonalPattern,
  isSecurityAdjacentFinding,
  mapRoleToPersona,
  parsePersonalKb,
  patternSimilarity,
  shouldApplyGenericPenalty,
  shouldUsePersonalMemory,
  toMemoryPattern,
  type FindingSeverity,
} from "./smartAgents";

const _self = fileURLToPath(import.meta.url);
// artifacts/api-server/src/lib/ → four levels up = workspace root
const REPO_ROOT = resolve(dirname(_self), '../../../../');

export type SmartFindingClassification = "discarded" | "observation" | "bug" | "test_target" | "no_finding";

export interface SmartAnalysisResult {
  classification: SmartFindingClassification;
  provider: string;
  fromKnowledgeBase: boolean;
  escalated: boolean;
  findingText: string | null;
  functionName: string | null;
  lineReference: string | null;
  issueType: string | null;
  codeReference: string | null;
  qualityReason: "unsupported_file" | "low_confidence" | "generic" | null;
  severity: FindingSeverity;
  baseConfidence: number;
  finalConfidence: number;
  bugsFound: number;
  testsGenerated: number;
  actionItems: string[];
  summary: string;
  findingId: number | null;
  pattern: string | null;
  isSecurityAdjacent: boolean;
  metadata: Record<string, unknown>;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function inferSeverityFromText(text: string): FindingSeverity {
  const lower = text.toLowerCase();

  if (/(security|injection|auth|token|secret|xss|sql|csrf|vulnerab|exploit)/.test(lower)) return "CRITICAL";
  if (/(null|undefined|throw|exception|panic|crash|unhandled)/.test(lower)) return "HIGH";
  if (/(performance|slow|latency|memory|loop|n\+1|blocking)/.test(lower)) return "MEDIUM";
  return "LOW";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatConfidence(value: number): string {
  return clampConfidence(value).toFixed(2);
}

function logFindingDecision(params: {
  filePath: string;
  confidence: number;
  calibratedConfidence: number;
  decision: "bug" | "observation" | "discard";
  reason: string;
}): void {
  console.log(
    `[FindingQuality] ${params.filePath} confidence=${formatConfidence(params.confidence)} `
      + `after_calibration=${formatConfidence(params.calibratedConfidence)} `
      + `decision=${params.decision} reason=${params.reason}`,
  );

  recordFindingPipelineAttempt({
    filePath: params.filePath,
    rawConfidence: params.confidence,
    calibratedConfidence: params.calibratedConfidence,
    decision: params.decision,
    reason: params.reason,
  });
}

function normalizeNoFindingText(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim();
  if (!normalized) return null;

  if (/^no\s+(real|concrete|verified)\s+bug/i.test(normalized)) return null;
  if (/^\{\s*"?finding"?\s*:\s*null\s*\}$/i.test(normalized)) return null;
  return normalized;
}

async function buildCodeSnippet(building: Building): Promise<string> {
  const metadata = [
    `FILE: ${building.filePath}`,
    `LANGUAGE: ${building.language}`,
    `TYPE: ${building.fileType}`,
    `LOC: ${building.linesOfCode}`,
    `COMPLEXITY: ${building.complexity}`,
    `HAS_TESTS: ${building.hasTests}`,
    `TEST_COVERAGE: ${building.testCoverage}`,
  ].join('\n');

  // Build candidate roots in priority order:
  // 1. fileWatcher watched path (the actively loaded local repo)
  // 2. process.cwd() (server working directory)
  // 3. REPO_ROOT (CodeCity tool root — for its own source files)
  const roots: string[] = [];
  const watchedPath = fileWatcher.getWatchedPath().trim();
  if (watchedPath) roots.push(watchedPath);
  const cwd = process.cwd();
  if (cwd !== REPO_ROOT) roots.push(cwd);
  roots.push(REPO_ROOT);

  if (isAbsolute(building.filePath)) {
    try {
      const content = await readFile(building.filePath, 'utf-8');
      const capped = content.length > 4000
        ? content.slice(0, 3000) + '\n\n... [truncated] ...\n\n' + content.slice(-1000)
        : content;
      return metadata + '\n\nSOURCE CODE:\n```' + (building.language || 'typescript') + '\n' + capped + '\n```';
    } catch {
      return metadata + '\n\n[Could not read file contents]';
    }
  }

  for (const root of roots) {
    const absPath = resolve(root, building.filePath);
    try {
      const content = await readFile(absPath, 'utf-8');
      const capped = content.length > 4000
        ? content.slice(0, 3000) + '\n\n... [truncated] ...\n\n' + content.slice(-1000)
        : content;
      return metadata + '\n\nSOURCE CODE:\n```' + (building.language || 'typescript') + '\n' + capped + '\n```';
    } catch {
      // try next root
    }
  }

  return metadata + '\n\n[File not found locally — no local repo loaded or file path not accessible]';
}

async function hasSharedKnowledgePattern(pattern: string, language: string): Promise<boolean> {
  const normalizedLanguage = language.trim().toLowerCase();
  const rows = await db
    .select({
      language: knowledgeTable.language,
      question: knowledgeTable.question,
      answer: knowledgeTable.answer,
      useCount: knowledgeTable.useCount,
    })
    .from(knowledgeTable)
    .where(gte(knowledgeTable.useCount, 6))
    .limit(250)
    .catch(() => []);

  for (const row of rows) {
    const rowLanguage = (row.language ?? "").toLowerCase();
    if (rowLanguage && rowLanguage !== normalizedLanguage) continue;

    const combined = `${row.question ?? ""} ${row.answer ?? ""}`;
    if (patternSimilarity(pattern, combined) > 0.7) return true;
  }

  return false;
}

async function insertFindingRow(params: {
  agentRow: typeof agentsTable.$inferSelect;
  building: Building;
  classification: SmartFindingClassification;
  status: string;
  provider: string;
  findingText: string | null;
  functionName: string | null;
  lineReference: string | null;
  severity: FindingSeverity;
  baseConfidence: number;
  finalConfidence: number;
  consultedBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<number | null> {
  const inserted = await db.insert(findingsTable).values({
    agentId: params.agentRow.id,
    agentName: params.agentRow.name,
    agentRole: params.agentRow.role,
    buildingId: params.building.id,
    buildingName: params.building.name,
    filePath: normalizePath(params.building.filePath),
    fileType: extractFileType(params.building.filePath),
    language: params.building.language,
    functionName: params.functionName,
    lineReference: params.lineReference,
    finding: params.findingText,
    severity: params.severity,
    baseConfidence: params.baseConfidence,
    finalConfidence: params.finalConfidence,
    classification: params.classification,
    status: params.status,
    source: params.provider,
    consultedBy: params.consultedBy ?? null,
    metadata: JSON.stringify(params.metadata ?? {}),
  }).returning({ id: findingsTable.id }).catch(() => []);

  return inserted[0]?.id ?? null;
}

function toEscalationPromptQuestion(role: string, building: Building, context: string): string {
  const roleLabel = role.replace(/_/g, " ");
  return [
    `Role ${roleLabel} analyzing ${building.filePath}.`,
    `Language: ${building.language}.`,
    `Complexity: ${building.complexity}.`,
    `Context: ${context}.`,
  ].join(" ");
}

function summarizeScribeResult(result: EscalationResult): string {
  const fn = result.functionName ?? "unknown function";
  const priority = result.priority ?? "HIGH";
  const testType = result.testType ?? "unit";
  return `Scribe prioritized ${fn} (${priority}, ${testType})`;
}

async function runRoleEscalation(params: {
  role: string;
  building: Building;
  context: string;
  codeSnippet: string;
  consultationContext?: string;
}): Promise<EscalationResult> {
  return await escalate({
    question: toEscalationPromptQuestion(params.role, params.building, params.context),
    codeSnippet: params.codeSnippet,
    language: params.building.language,
    failedAttempts: [],
    agentRole: params.role,
    filePath: normalizePath(params.building.filePath),
    consultationContext: params.consultationContext,
  });
}

export async function analyzeBuildingForAgent(params: {
  agentRow: typeof agentsTable.$inferSelect;
  building: Building;
  context: string;
  consultedBy?: string;
  roleOverride?: string;
}): Promise<SmartAnalysisResult> {
  const role = params.roleOverride ?? params.agentRow.role;
  const persona = mapRoleToPersona(role);
  const filePath = normalizePath(params.building.filePath);
  const personalEntries = parsePersonalKb(params.agentRow.personalKB);

  if (persona === "alchemist") {
    const command = "git status --short";
    const execution = await runAlchemistCommand({ command, timeoutMs: 20_000 });
    const findingText = `Alchemist command ${command} finished with status=${execution.status}`;
    const findingId = await insertFindingRow({
      agentRow: params.agentRow,
      building: params.building,
      classification: "observation",
      status: "observation",
      provider: "alchemist_command",
      findingText,
      functionName: null,
      lineReference: null,
      severity: execution.status === "success" ? "LOW" : "MEDIUM",
      baseConfidence: 0.95,
      finalConfidence: 0.95,
      consultedBy: params.consultedBy,
      metadata: {
        command,
        status: execution.status,
        exitCode: execution.exitCode,
        reason: execution.reason ?? null,
      },
    });

    return {
      classification: "observation",
      provider: "alchemist_command",
      fromKnowledgeBase: false,
      escalated: false,
      findingText,
      functionName: null,
      lineReference: null,
      issueType: null,
      codeReference: null,
      qualityReason: null,
      severity: execution.status === "success" ? "LOW" : "MEDIUM",
      baseConfidence: 0.95,
      finalConfidence: 0.95,
      bugsFound: 0,
      testsGenerated: 0,
      actionItems: ["Review command output", "Decide whether to run deeper diagnostics"],
      summary: findingText,
      findingId,
      pattern: null,
      isSecurityAdjacent: false,
      metadata: {
        command,
        status: execution.status,
      },
    };
  }

  const warmPattern = toMemoryPattern({
    persona,
    filePath,
    finding: `${params.context} ${params.building.name}`,
  });
  const warmPatternMatch = findSimilarPersonalPattern(personalEntries, warmPattern, 0.7);
  const preAnalysisPatternBoost = warmPatternMatch !== null;
  if (preAnalysisPatternBoost) {
    console.log(`[PersonalKB] ${params.agentRow.name} found similar historical pattern before analysis`);
  }

  const directMemory = shouldUsePersonalMemory(personalEntries, warmPattern);

  let provider = "groq";
  let findingText: string | null = null;
  let functionName: string | null = null;
  let lineReference: string | null = null;
  let severity: FindingSeverity = "LOW";
  let baseConfidence = 0.4;
  let actionItems: string[] = [];

  if (directMemory) {
    console.log(`[PersonalKB] ${params.agentRow.name} recognized pattern from personal experience`);
    provider = "personal_memory";
    findingText = `Remembered pattern: ${directMemory.entry.pattern}`;
    functionName = "memory_pattern";
    lineReference = "from prior confirmed finding";
    severity = inferSeverityFromText(directMemory.entry.pattern);
    baseConfidence = clampConfidence(directMemory.entry.confidence + 0.15);
    actionItems = ["Validate memory-based finding quickly", "Generate a regression test for this pattern"];
  } else {
    const snippet = await buildCodeSnippet(params.building);
    console.log(`[Agent] ${params.building.filePath}: ${snippet.includes('SOURCE CODE:') ? 'real code (' + snippet.length + ' chars)' : 'metadata only'}`);
    const escalation = await runRoleEscalation({
      role,
      building: params.building,
      context: params.context,
      codeSnippet: snippet,
      consultationContext: params.consultedBy
        ? `Consulted by ${params.consultedBy}: ${params.context}`
        : undefined,
    });

    provider = escalation.source;
    actionItems = escalation.action_items.length > 0
      ? escalation.action_items
      : ["Review the finding details", "Convert the finding into reproducible tests"];

    if (persona === "scribe") {
      const summary = summarizeScribeResult(escalation);
      const scribeFinding = escalation.answer.trim() || summary;
      const findingId = await insertFindingRow({
        agentRow: params.agentRow,
        building: params.building,
        classification: "test_target",
        status: "pending",
        provider,
        findingText: scribeFinding,
        functionName: escalation.functionName ?? null,
        lineReference: null,
        severity: escalation.priority ?? "HIGH",
        baseConfidence: clampConfidence(escalation.confidence),
        finalConfidence: clampConfidence(escalation.confidence),
        consultedBy: params.consultedBy,
        metadata: {
          testType: escalation.testType ?? "unit",
          priority: escalation.priority ?? "HIGH",
          actionItems,
        },
      });

      return {
        classification: "test_target",
        provider,
        fromKnowledgeBase: escalation.source === "knowledge_base",
        escalated: escalation.source !== "knowledge_base" && escalation.source !== "fallback",
        findingText: scribeFinding,
        functionName: escalation.functionName ?? null,
        lineReference: null,
        issueType: null,
        codeReference: null,
        qualityReason: null,
        severity: escalation.priority ?? "HIGH",
        baseConfidence: clampConfidence(escalation.confidence),
        finalConfidence: clampConfidence(escalation.confidence),
        bugsFound: 0,
        testsGenerated: 1,
        actionItems,
        summary,
        findingId,
        pattern: null,
        isSecurityAdjacent: false,
        metadata: {
          testType: escalation.testType ?? "unit",
          priority: escalation.priority ?? "HIGH",
        },
      };
    }

    findingText = normalizeNoFindingText(escalation.finding ?? escalation.answer);
    functionName = escalation.functionName ?? null;
    lineReference = escalation.lineReference ?? null;
    severity = escalation.severity ?? inferSeverityFromText(escalation.finding ?? escalation.answer);
    baseConfidence = clampConfidence(Number(escalation.confidence));

    if (preAnalysisPatternBoost) {
      baseConfidence = clampConfidence(baseConfidence + 0.15);
      console.log(`[PersonalKB] ${params.agentRow.name} confidence boosted +0.15 from pre-analysis match`);
    }
  }

  if (!findingText) {
    logFindingDecision({
      filePath,
      confidence: baseConfidence,
      calibratedConfidence: baseConfidence,
      decision: "discard",
      reason: "no_finding",
    });

    const findingId = await insertFindingRow({
      agentRow: params.agentRow,
      building: params.building,
      classification: "no_finding",
      status: "no_finding",
      provider,
      findingText: null,
      functionName: null,
      lineReference: null,
      severity: "LOW",
      baseConfidence,
      finalConfidence: baseConfidence,
      consultedBy: params.consultedBy,
      metadata: { reason: "no_finding" },
    });

    return {
      classification: "no_finding",
      provider,
      fromKnowledgeBase: provider === "knowledge_base",
      escalated: provider !== "knowledge_base" && provider !== "fallback" && provider !== "personal_memory",
      findingText: null,
      functionName: null,
      lineReference: null,
      issueType: null,
      codeReference: null,
      qualityReason: null,
      severity: "LOW",
      baseConfidence,
      finalConfidence: baseConfidence,
      bugsFound: 0,
      testsGenerated: 0,
      actionItems,
      summary: `No concrete issue found in ${params.building.name}`,
      findingId,
      pattern: null,
      isSecurityAdjacent: false,
      metadata: {},
    };
  }

  const pattern = toMemoryPattern({
    persona,
    filePath,
    finding: findingText,
    functionName,
  });

  const personalMatch = findSimilarPersonalPattern(personalEntries, pattern, 0.7);
  if (personalMatch) {
    console.log(`[PersonalKB] ${params.agentRow.name} recognized pattern from personal experience`);
    baseConfidence = clampConfidence(baseConfidence + 0.15);
  }

  const sharedPatternMatch = await hasSharedKnowledgePattern(pattern, params.building.language);
  const calibration = calibrateConfidence({
    baseConfidence,
    personalPatternMatch: personalMatch !== null,
    personalExperienceMatch: directMemory !== null,
    sharedPatternMatch,
    accuracy: params.agentRow.accuracy,
    genericFinding: shouldApplyGenericPenalty({
      findingText,
      functionName,
      lineReference,
    }),
  });

  const qualityAssessment = assessFindingCandidate({
    agentName: params.agentRow.name,
    filePath,
    findingText,
    functionName,
    lineReference,
    confidence: calibration.after,
  });

  let classification: SmartFindingClassification = "discarded";
  let status = "discarded";
  let effectiveFindingText: string | null = findingText;
  let effectiveIssueType: string | null = null;
  let effectiveCodeReference: string | null = lineReference;
  let qualityReason: "unsupported_file" | "low_confidence" | "generic" | null = null;

  if (qualityAssessment.status === "accepted") {
    classification = "bug";
    status = "pending";
    effectiveFindingText = qualityAssessment.finding.findingText;
    effectiveIssueType = qualityAssessment.finding.issueType;
    effectiveCodeReference = lineReference ?? qualityAssessment.finding.codeReference;
  } else if (qualityAssessment.status === "observation") {
    classification = "observation";
    status = "observation";
    qualityReason = qualityAssessment.reason;
    effectiveFindingText = qualityAssessment.observation;
    effectiveCodeReference = lineReference ?? null;
  } else {
    classification = "discarded";
    status = "discarded";
    qualityReason = qualityAssessment.reason === "generic" || qualityAssessment.reason === "low_confidence"
      ? qualityAssessment.reason
      : null;
    effectiveFindingText = findingText;
    effectiveCodeReference = lineReference ?? null;
  }

  const decision = classification === "bug"
    ? "bug"
    : classification === "observation"
      ? "observation"
      : "discard";
  const reason = qualityReason
    ?? (qualityAssessment.status === "accepted" ? "accepted" : qualityAssessment.status);

  logFindingDecision({
    filePath,
    confidence: calibration.before,
    calibratedConfidence: calibration.after,
    decision,
    reason,
  });

  const findingId = await insertFindingRow({
    agentRow: params.agentRow,
    building: params.building,
    classification,
    status,
    provider,
    findingText: effectiveFindingText,
    functionName,
    lineReference: effectiveCodeReference,
    severity,
    baseConfidence: calibration.before,
    finalConfidence: calibration.after,
    consultedBy: params.consultedBy,
    metadata: {
      modifiers: calibration.modifiers,
      sharedPatternMatch,
      personalPatternMatch: personalMatch !== null,
      pattern,
      qualityReason,
      qualityStatus: qualityAssessment.status,
    },
  });

  const isSecurityIssue = isSecurityAdjacentFinding({
    filePath,
    finding: effectiveFindingText,
    functionName,
  });

  return {
    classification,
    provider,
    fromKnowledgeBase: provider === "knowledge_base",
    escalated: provider !== "knowledge_base" && provider !== "fallback" && provider !== "personal_memory",
    findingText: effectiveFindingText,
    functionName,
    lineReference: effectiveCodeReference,
    issueType: effectiveIssueType,
    codeReference: effectiveCodeReference,
    qualityReason,
    severity,
    baseConfidence: calibration.before,
    finalConfidence: calibration.after,
    bugsFound: classification === "bug" ? 1 : 0,
    testsGenerated: 0,
    actionItems,
    summary: classification === "bug"
      ? (effectiveFindingText ?? `Potential issue in ${params.building.filePath}`)
      : classification === "observation"
        ? `Observation: ${effectiveFindingText ?? "no observation text"}`
        : `Discarded: ${effectiveFindingText ?? "generic finding"}`,
    findingId,
    pattern,
    isSecurityAdjacent: isSecurityIssue,
    metadata: {
      calibrationModifiers: calibration.modifiers,
      qualityReason,
      qualityStatus: qualityAssessment.status,
    },
  };
}

export async function getLatestPendingBugFinding(agentId: string): Promise<(typeof findingsTable.$inferSelect) | null> {
  const rows = await db
    .select()
    .from(findingsTable)
    .where(and(
      eq(findingsTable.agentId, agentId),
      eq(findingsTable.classification, "bug"),
      eq(findingsTable.status, "pending"),
    ))
    .orderBy(desc(findingsTable.id))
    .limit(1)
    .catch(() => []);

  return rows[0] ?? null;
}

export async function updateFindingVerdictStatus(params: {
  findingId: number;
  status: "confirmed_true" | "confirmed_false";
}): Promise<void> {
  await db.update(findingsTable).set({
    status: params.status,
    updatedAt: new Date().toISOString(),
  }).where(eq(findingsTable.id, params.findingId));
}
