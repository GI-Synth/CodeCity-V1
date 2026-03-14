import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { basename, extname } from "node:path";
import { classifyFindingSeverity, type FindingSeverity } from "./escalationEngine";

const REPORTABLE_SOURCE_EXTENSIONS = new Set([".ts", ".js", ".py", ".go", ".rs"]);
const GENERIC_FINDING_MARKERS = [
  "this file has complexity",
  "file has complexity",
  "might have bugs",
  "might exist",
  "potential issues",
  "this file has issues",
  "needs review",
  "complexity is high",
  "generic analysis",
  "possible bug",
];

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export type AcceptedFinding = {
  filePath: string;
  findingText: string;
  confidence: number;
  issueType: string;
  codeReference: string;
};

export type FindingAssessment =
  | {
    status: "accepted";
    finding: AcceptedFinding;
  }
  | {
    status: "observation";
    reason: "unsupported_file" | "low_confidence";
    observation: string;
  }
  | {
    status: "discarded";
    reason: "empty" | "generic";
  };

export type PersistedFindingResult = {
  status: "new" | "duplicate";
  confirmations: number;
  eventId: string;
  severity: FindingSeverity;
};

type PersistFindingInput = {
  agentId: string;
  agentName: string;
  buildingId?: string | null;
  buildingName?: string | null;
  filePath: string;
  findingText: string;
  issueType: string;
  confidence: number;
  codeReference: string;
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}

function compactText(text: string, max = 220): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function countWords(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function parseEventTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const isoLike = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = isoLike.endsWith("Z") ? isoLike : `${isoLike}Z`;
  const parsed = Date.parse(withZone);
  if (!Number.isNaN(parsed)) return parsed;

  const fallback = Date.parse(value);
  return Number.isNaN(fallback) ? null : fallback;
}

function normalizeSeverity(raw: string | null | undefined): FindingSeverity | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "CRITICAL" || upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") return upper;
  return null;
}

function strongestSeverity(a: FindingSeverity, b: string | null | undefined): FindingSeverity {
  const parsed = normalizeSeverity(b);
  if (!parsed) return a;
  return SEVERITY_RANK[parsed] >= SEVERITY_RANK[a] ? parsed : a;
}

function toLegacyEventSeverity(severity: FindingSeverity): "critical" | "warning" | "info" {
  if (severity === "CRITICAL") return "critical";
  if (severity === "HIGH" || severity === "MEDIUM") return "warning";
  return "info";
}

function hasSpecificReference(text: string): boolean {
  const lineRef = /\bline\s+\d+\b|\bL\d+\b|:\d+(?::\d+)?\b/i;
  if (lineRef.test(text)) return true;

  const functionRef = /\b(?:function|method|class|handler|module)\s+[`'\"]?[A-Za-z_$][\w$]*[`'\"]?/i;
  if (functionRef.test(text)) return true;

  const invocationRef = /\b[A-Za-z_$][\w$]*\s*\([^\n)]{0,80}\)/;
  if (invocationRef.test(text)) return true;

  const codeFenceRef = /`[^`]{3,120}`/;
  if (codeFenceRef.test(text)) return true;

  const codePatternRef = /\b(?:if|for|while|switch|await|throw|catch|try)\b\s*\(?/i;
  return codePatternRef.test(text);
}

function isGenericFinding(text: string): boolean {
  const lower = text.toLowerCase();
  if (countWords(text) < 20) return true;
  if (!hasSpecificReference(text)) return true;
  return GENERIC_FINDING_MARKERS.some(marker => lower.includes(marker));
}

export function isReportableSourceFilePath(filePath: string): boolean {
  const ext = extname(normalizePath(filePath).toLowerCase());
  return REPORTABLE_SOURCE_EXTENSIONS.has(ext);
}

export function inferIssueType(findingText: string): string {
  const lower = findingText.toLowerCase();

  if (/(security|injection|xss|csrf|auth|token|permission)/.test(lower)) return "security";
  if (/(null|undefined|throw|exception|panic|crash)/.test(lower)) return "runtime_error";
  if (/(race|deadlock|concurrent|locking)/.test(lower)) return "concurrency";
  if (/(logic|incorrect|wrong|broken|regression)/.test(lower)) return "logic_error";
  if (/(validation|sanitize|unsanitized|input check|missing check)/.test(lower)) return "missing_validation";
  if (/(performance|slow|latency|memory|loop|n\+1)/.test(lower)) return "performance";
  return "code_quality";
}

export function extractCodeReference(findingText: string): string {
  const lineRef = findingText.match(/\bline\s+\d+\b|\bL\d+\b|:\d+(?::\d+)?\b/i);
  if (lineRef?.[0]) return lineRef[0];

  const fencedRef = findingText.match(/`([^`]{3,120})`/);
  if (fencedRef?.[1]) return compactText(fencedRef[1], 80);

  const invocationRef = findingText.match(/\b[A-Za-z_$][\w$]*\s*\([^\n)]{0,80}\)/);
  if (invocationRef?.[0]) return compactText(invocationRef[0], 80);

  const namedRef = findingText.match(/\b(?:function|method|class|handler|module)\s+[`'\"]?([A-Za-z_$][\w$]*)[`'\"]?/i);
  if (namedRef?.[1]) return `${namedRef[0].split(/\s+/)[0]} ${namedRef[1]}`;

  return "specific pattern referenced";
}

export function assessFindingCandidate(params: {
  agentName: string;
  filePath: string;
  findingText: string;
  confidence: number;
}): FindingAssessment {
  const normalizedPath = normalizePath(params.filePath);
  const normalizedText = compactText(params.findingText, 1200);

  if (!normalizedText) {
    return { status: "discarded", reason: "empty" };
  }

  if (!isReportableSourceFilePath(normalizedPath)) {
    return {
      status: "observation",
      reason: "unsupported_file",
      observation: `${params.agentName} observation: skipped non-source finding in ${normalizedPath}.`,
    };
  }

  if (params.confidence < 0.75) {
    const confidencePercent = Math.round(params.confidence * 100);
    return {
      status: "observation",
      reason: "low_confidence",
      observation: `${params.agentName} low-confidence (${confidencePercent}%) observation in ${normalizedPath}: ${compactText(normalizedText, 180)}`,
    };
  }

  if (isGenericFinding(normalizedText)) {
    console.log(`[QA] Discarded generic finding in ${normalizedPath}`);
    return { status: "discarded", reason: "generic" };
  }

  return {
    status: "accepted",
    finding: {
      filePath: normalizedPath,
      findingText: normalizedText,
      confidence: params.confidence,
      issueType: inferIssueType(normalizedText),
      codeReference: extractCodeReference(normalizedText),
    },
  };
}

export async function recordObservationEvent(params: {
  agentId: string;
  agentName: string;
  buildingId?: string | null;
  buildingName?: string | null;
  filePath: string;
  observation: string;
  confidence?: number;
  eventType?: "finding_observation" | "finding_low_confidence";
}): Promise<void> {
  await db.insert(eventsTable).values({
    id: `evt-${Date.now()}-obs-${Math.random().toString(36).slice(2, 6)}`,
    type: params.eventType ?? "finding_observation",
    agentId: params.agentId,
    agentName: params.agentName,
    buildingId: params.buildingId ?? null,
    buildingName: params.buildingName ?? basename(normalizePath(params.filePath)),
    message: compactText(params.observation, 240),
    severity: "info",
    filePath: normalizePath(params.filePath),
    confidence: params.confidence ?? null,
  }).catch(() => {});
}

export async function recordDiscardedFindingEvent(params: {
  agentId: string;
  agentName: string;
  buildingId?: string | null;
  buildingName?: string | null;
  filePath: string;
  findingText: string;
  reason: string;
  confidence?: number;
  eventType?: "finding_discarded" | "finding_discarded_generic";
}): Promise<void> {
  await db.insert(eventsTable).values({
    id: `evt-${Date.now()}-discard-${Math.random().toString(36).slice(2, 6)}`,
    type: params.eventType ?? "finding_discarded",
    agentId: params.agentId,
    agentName: params.agentName,
    buildingId: params.buildingId ?? null,
    buildingName: params.buildingName ?? basename(normalizePath(params.filePath)),
    message: `[QA] Discarded ${params.reason} finding in ${normalizePath(params.filePath)}: ${compactText(params.findingText, 180)}`,
    severity: "info",
    filePath: normalizePath(params.filePath),
    confidence: params.confidence ?? null,
  }).catch(() => {});
}

export async function classifyAndPersistBugFinding(input: PersistFindingInput): Promise<PersistedFindingResult> {
  const normalizedPath = normalizePath(input.filePath);
  const severity = await classifyFindingSeverity({
    finding: input.findingText,
    filePath: normalizedPath,
  });

  const existing = await db
    .select({
      id: eventsTable.id,
      timestamp: eventsTable.timestamp,
      confirmations: eventsTable.confirmations,
      findingSeverity: eventsTable.findingSeverity,
      confidence: eventsTable.confidence,
      codeReference: eventsTable.codeReference,
      findingText: eventsTable.findingText,
    })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.type, "bug_found"),
      eq(eventsTable.filePath, normalizedPath),
      eq(eventsTable.issueType, input.issueType),
    ))
    .orderBy(desc(eventsTable.timestamp))
    .limit(25);

  const cutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const duplicate = existing.find((row) => {
    const ts = parseEventTimestamp(row.timestamp);
    return ts !== null && ts >= cutoffMs;
  });

  if (duplicate) {
    const confirmations = Math.max(1, duplicate.confirmations ?? 1) + 1;
    const mergedSeverity = strongestSeverity(severity, duplicate.findingSeverity);
    const maxConfidence = Math.max(duplicate.confidence ?? 0, input.confidence);
    const mergedCodeReference = duplicate.codeReference ?? input.codeReference;
    const mergedFindingText = duplicate.findingText ?? input.findingText;

    await db.update(eventsTable).set({
      confirmations,
      confidence: maxConfidence,
      findingSeverity: mergedSeverity,
      codeReference: mergedCodeReference,
      findingText: mergedFindingText,
      severity: toLegacyEventSeverity(mergedSeverity),
    }).where(eq(eventsTable.id, duplicate.id));

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-kept-${Math.random().toString(36).slice(2, 6)}`,
      type: "finding_kept",
      agentId: input.agentId,
      agentName: input.agentName,
      buildingId: input.buildingId ?? null,
      buildingName: input.buildingName ?? basename(normalizedPath),
      message: `${input.agentName} confirmed existing bug in ${normalizedPath}: ${compactText(mergedFindingText, 180)}`,
      severity: toLegacyEventSeverity(mergedSeverity),
      filePath: normalizedPath,
      issueType: input.issueType,
      confidence: maxConfidence,
      codeReference: mergedCodeReference,
      confirmations,
      findingSeverity: mergedSeverity,
      findingText: mergedFindingText,
    }).catch(() => {});

    return {
      status: "duplicate",
      confirmations,
      eventId: duplicate.id,
      severity: mergedSeverity,
    };
  }

  const eventId = `evt-${Date.now()}-bug-${Math.random().toString(36).slice(2, 6)}`;
  await db.insert(eventsTable).values({
    id: eventId,
    type: "bug_found",
    agentId: input.agentId,
    agentName: input.agentName,
    buildingId: input.buildingId ?? null,
    buildingName: input.buildingName ?? basename(normalizedPath),
    message: `${input.agentName} found bug in ${normalizedPath}: ${compactText(input.findingText, 180)}`,
    severity: toLegacyEventSeverity(severity),
    filePath: normalizedPath,
    issueType: input.issueType,
    confidence: input.confidence,
    codeReference: input.codeReference,
    confirmations: 1,
    findingSeverity: severity,
    findingText: input.findingText,
  });

  return {
    status: "new",
    confirmations: 1,
    eventId,
    severity,
  };
}
