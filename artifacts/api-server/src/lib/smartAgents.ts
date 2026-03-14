import { basename, extname } from "node:path";

export type AgentRoleId = "qa_inspector" | "api_fuzzer" | "load_tester" | "edge_explorer" | "ui_navigator" | "scribe";
export type AgentPersona = "inspector" | "guardian" | "optimizer" | "architect" | "scribe" | "alchemist";
export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type FindingClassification = "discarded" | "observation" | "bug" | "test_target" | "no_finding";

export interface PersonalKbEntry {
  pattern: string;
  fileType: string;
  language: string;
  confidence: number;
  timesFound: number;
  confirmedCount?: number;
  updatedAt?: string;
}

export interface BugStyleFinding {
  finding: string | null;
  lineReference: string | null;
  severity: FindingSeverity;
  confidence: number;
  functionName: string | null;
  cveReference?: string | null;
  estimatedPerformanceImpact?: string | null;
  couplingImports?: string[];
}

export interface ScribeRecommendation {
  functionName: string;
  reason: string;
  testType: "unit" | "integration" | "e2e";
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  confidence: number;
}

export interface CalibrationInput {
  baseConfidence: number;
  personalPatternMatch: boolean;
  personalExperienceMatch: boolean;
  sharedPatternMatch: boolean;
  accuracy: number;
  filePreviouslyNoFinding: boolean;
  genericFinding: boolean;
}

export interface CalibrationResult {
  before: number;
  after: number;
  modifiers: string[];
  classification: "discarded" | "observation" | "bug";
}

export interface GenericFindingInput {
  findingText: string | null | undefined;
  functionName?: string | null;
  lineReference?: string | null;
}

export interface RolePrompt {
  system: string;
  prompt: string;
  expects: "bug" | "scribe";
}

const TOKEN_SPLIT_REGEX = /[^a-z0-9_]+/i;
const LINE_REFERENCE_REGEX = /\bline\s+\d+\b|\bL\d+\b|:\d+(?::\d+)?\b/i;
const FUNCTION_REFERENCE_REGEX = /\b[a-zA-Z_$][\w$]*\s*\(|\b[a-z]+[A-Z][A-Za-z0-9_$]*\b/;

const SPECIFIC_PATTERN_MARKERS = [
  "try-catch",
  "try/catch",
  "null check",
  "undefined check",
  "promise rejection",
  "race condition",
  "off-by-one",
  "n+1",
  "sql injection",
  "circular dependency",
  "memory leak",
  "deadlock",
  "auth bypass",
  "input validation",
];

const CODE_KEYWORDS = [
  "async",
  "await",
  "try",
  "catch",
  "throw",
  "promise",
  "rejection",
  "null",
  "undefined",
  "return",
  "token",
  "provider",
  "auth",
  "sql",
  "xss",
  "csrf",
  "regex",
  "parse",
  "serialize",
  "import",
];

const DISCARD_THRESHOLD = 0.50;
const OBSERVATION_THRESHOLD = 0.55;
const BUG_THRESHOLD = 0.72;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function hasLineReference(lineReference: string | null | undefined, findingText: string): boolean {
  const explicitLine = safeString(lineReference);
  if (explicitLine.length > 0) return true;
  return LINE_REFERENCE_REGEX.test(findingText);
}

function hasFunctionReference(functionName: string | null | undefined, findingText: string): boolean {
  const explicitFunction = safeString(functionName);
  if (explicitFunction.length > 0) return true;
  return FUNCTION_REFERENCE_REGEX.test(findingText);
}

function hasSpecificPatternName(findingText: string): boolean {
  const lower = findingText.toLowerCase();
  return SPECIFIC_PATTERN_MARKERS.some(marker => lower.includes(marker));
}

function hasCodeKeyword(findingText: string): boolean {
  const tokens = tokenize(findingText);
  for (const keyword of CODE_KEYWORDS) {
    if (tokens.has(keyword)) return true;
  }

  // Keep hyphenated terms detectable even when tokenizer splits punctuation.
  const lower = findingText.toLowerCase();
  return lower.includes("try-catch") || lower.includes("try/catch") || lower.includes("n+1");
}

function normalizeSeverity(value: string): FindingSeverity {
  const upper = value.trim().toUpperCase();
  if (upper === "CRITICAL" || upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") {
    return upper;
  }
  return "LOW";
}

function normalizePriority(value: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  return normalizeSeverity(value);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(TOKEN_SPLIT_REGEX)
      .map(token => token.trim())
      .filter(token => token.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function parseRawJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // fall through to best-effort extraction
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

export function mapRoleToPersona(role: string): AgentPersona {
  if (role === "qa_inspector" || role === "inspector") return "inspector";
  if (role === "api_fuzzer" || role === "guardian") return "guardian";
  if (role === "load_tester" || role === "optimizer") return "optimizer";
  if (role === "edge_explorer" || role === "architect") return "architect";
  if (role === "scribe") return "scribe";
  if (role === "alchemist") return "alchemist";
  return "alchemist";
}

export function personaEmoji(persona: AgentPersona): string {
  if (persona === "inspector") return "🔍";
  if (persona === "guardian") return "🛡";
  if (persona === "optimizer") return "⚡";
  if (persona === "architect") return "🏗";
  if (persona === "scribe") return "📋";
  return "🧪";
}

export function extractFileType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext) return ext;
  return basename(filePath).toLowerCase();
}

export function normalizePattern(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[\t\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "unspecified-pattern";
  return normalized.slice(0, 220);
}

export function patternSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const score = jaccard(ta, tb);

  if (score > 0) return score;

  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (!lowerA || !lowerB) return 0;

  if (lowerA.includes(lowerB) || lowerB.includes(lowerA)) return 0.75;
  return 0;
}

export function parsePersonalKb(raw: string | null | undefined): PersonalKbEntry[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const nowIso = new Date().toISOString();
    const out: PersonalKbEntry[] = [];

    for (const item of parsed) {
      if (typeof item === "string") {
        const pattern = normalizePattern(item);
        out.push({
          pattern,
          fileType: "unknown",
          language: "unknown",
          confidence: 0.7,
          timesFound: 1,
          confirmedCount: 1,
          updatedAt: nowIso,
        });
        continue;
      }

      if (!item || typeof item !== "object") continue;

      const entry = item as Record<string, unknown>;
      const pattern = normalizePattern(safeString(entry.pattern));
      if (!pattern) continue;

      out.push({
        pattern,
        fileType: safeString(entry.fileType) || "unknown",
        language: safeString(entry.language) || "unknown",
        confidence: clampConfidence(Number(entry.confidence ?? 0.7)),
        timesFound: Math.max(1, Number(entry.timesFound ?? 1)),
        confirmedCount: Math.max(1, Number(entry.confirmedCount ?? entry.timesFound ?? 1)),
        updatedAt: safeString(entry.updatedAt) || nowIso,
      });
    }

    return out.slice(-250);
  } catch {
    return [];
  }
}

export function serializePersonalKb(entries: PersonalKbEntry[]): string {
  return JSON.stringify(entries.slice(-250));
}

export function findSimilarPersonalPattern(
  entries: PersonalKbEntry[],
  pattern: string,
  threshold = 0.7,
): { index: number; similarity: number } | null {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const score = patternSimilarity(pattern, entries[i].pattern);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < threshold) return null;
  return { index: bestIndex, similarity: bestScore };
}

export function getTopLanguageFromPersonalKb(entries: PersonalKbEntry[]): string | null {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const lang = entry.language.trim().toLowerCase();
    if (!lang || lang === "unknown") continue;
    const next = (totals.get(lang) ?? 0) + Math.max(1, entry.timesFound);
    totals.set(lang, next);
  }

  let best: string | null = null;
  let bestScore = -1;
  for (const [language, score] of totals.entries()) {
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }

  return best;
}

export function shouldUsePersonalMemory(
  entries: PersonalKbEntry[],
  pattern: string,
): { entry: PersonalKbEntry; similarity: number } | null {
  const match = findSimilarPersonalPattern(entries, pattern, 0.7);
  if (!match) return null;

  const entry = entries[match.index];
  if (entry.timesFound <= 5) return null;

  return { entry, similarity: match.similarity };
}

export function applyConfirmedFindingToPersonalKb(params: {
  entries: PersonalKbEntry[];
  pattern: string;
  fileType: string;
  language: string;
  confidence: number;
}): PersonalKbEntry[] {
  const next = [...params.entries];
  const normalizedPattern = normalizePattern(params.pattern);
  const nowIso = new Date().toISOString();
  const match = findSimilarPersonalPattern(next, normalizedPattern, 0.7);

  if (!match) {
    next.push({
      pattern: normalizedPattern,
      fileType: params.fileType || "unknown",
      language: params.language || "unknown",
      confidence: clampConfidence(params.confidence),
      timesFound: 1,
      confirmedCount: 1,
      updatedAt: nowIso,
    });

    return next.slice(-250);
  }

  const existing = next[match.index];
  const confirmedCount = Math.max(1, Number(existing.confirmedCount ?? existing.timesFound ?? 1)) + 1;
  let timesFound = Math.max(1, existing.timesFound) + 1;

  // After sustained confirmation, promote pattern strength faster.
  if (confirmedCount >= 10) {
    timesFound += 1;
  }

  next[match.index] = {
    ...existing,
    pattern: normalizedPattern,
    fileType: params.fileType || existing.fileType || "unknown",
    language: params.language || existing.language || "unknown",
    confidence: clampConfidence(Math.max(existing.confidence, params.confidence)),
    timesFound,
    confirmedCount,
    updatedAt: nowIso,
  };

  return next.slice(-250);
}

export function buildRolePrompt(params: {
  persona: AgentPersona;
  language: string;
  filePath: string;
  codeSnippet: string;
  context?: string;
}): RolePrompt | null {
  const snippet = params.codeSnippet.slice(0, 5000);
  const contextLine = params.context?.trim() ? `\nConsultation context: ${params.context?.trim()}` : "";

  if (params.persona === "alchemist") return null;

  if (params.persona === "inspector") {
    return {
      system: "You are a meticulous bug hunter. Return JSON only.",
      prompt: [
        `You are a meticulous bug hunter reviewing ${params.language} code.`,
        "Look ONLY for: logic errors, null pointer risks,",
        "unhandled promise rejections, incorrect conditionals,",
        "off-by-one errors, missing return values.",
        `File: ${params.filePath}`,
        `Code: ${snippet}`,
        contextLine,
        "",
        "Respond in JSON:",
        "{",
        "  finding: string (specific, under 50 words),",
        "  lineReference: string (e.g. 'around line 47'),",
        "  severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',",
        "  confidence: number (0-1),",
        "  functionName: string (which function has the issue)",
        "}",
        "If no real bug found: { finding: null }",
      ].join("\n"),
      expects: "bug",
    };
  }

  if (params.persona === "guardian") {
    return {
      system: "You are a security-focused code reviewer. Return JSON only.",
      prompt: [
        `You are a security guardian reviewing ${params.language} code.`,
        "Look ONLY for: SQL injection, XSS, missing auth, hardcoded secrets,",
        "insecure API endpoints, missing input validation.",
        "Always include CVE reference if known.",
        `File: ${params.filePath}`,
        `Code: ${snippet}`,
        contextLine,
        "",
        "Respond in JSON:",
        "{",
        "  finding: string (specific, under 50 words),",
        "  lineReference: string (e.g. 'around line 47'),",
        "  severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',",
        "  confidence: number (0-1),",
        "  functionName: string (which function has the issue),",
        "  cveReference: string|null",
        "}",
        "If no real bug found: { finding: null }",
      ].join("\n"),
      expects: "bug",
    };
  }

  if (params.persona === "optimizer") {
    return {
      system: "You are a performance optimization expert. Return JSON only.",
      prompt: [
        `You are a performance optimizer reviewing ${params.language} code.`,
        "Look ONLY for: O(n^2) algorithms, N+1 queries, blocking async operations,",
        "memory leaks, unnecessary re-computation in loops.",
        "Always include estimated performance impact.",
        `File: ${params.filePath}`,
        `Code: ${snippet}`,
        contextLine,
        "",
        "Respond in JSON:",
        "{",
        "  finding: string (specific, under 50 words),",
        "  lineReference: string (e.g. 'around line 47'),",
        "  severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',",
        "  confidence: number (0-1),",
        "  functionName: string (which function has the issue),",
        "  estimatedPerformanceImpact: string",
        "}",
        "If no real bug found: { finding: null }",
      ].join("\n"),
      expects: "bug",
    };
  }

  if (params.persona === "architect") {
    return {
      system: "You are a software architect reviewing maintainability risks. Return JSON only.",
      prompt: [
        `You are an architecture specialist reviewing ${params.language} code.`,
        "Look ONLY for: circular dependencies, files doing too many things,",
        "missing abstractions, wrong separation of concerns.",
        "Reference specific imports that cause coupling.",
        `File: ${params.filePath}`,
        `Code: ${snippet}`,
        contextLine,
        "",
        "Respond in JSON:",
        "{",
        "  finding: string (specific, under 50 words),",
        "  lineReference: string (e.g. 'around line 47'),",
        "  severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',",
        "  confidence: number (0-1),",
        "  functionName: string (which function has the issue),",
        "  couplingImports: string[]",
        "}",
        "If no real bug found: { finding: null }",
      ].join("\n"),
      expects: "bug",
    };
  }

  return {
    system: "You are a QA planning specialist. Return JSON only.",
    prompt: [
      "You are The Scribe. You do not look for bugs.",
      "Identify what functions need tests most urgently.",
      `File: ${params.filePath}`,
      `Code: ${snippet}`,
      contextLine,
      "",
      "Respond in JSON:",
      "{",
      "  functionName: string,",
      "  reason: string,",
      "  testType: 'unit'|'integration'|'e2e',",
      "  priority: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',",
      "  confidence: number",
      "}",
    ].join("\n"),
    expects: "scribe",
  };
}

export function parseRoleResponse(persona: AgentPersona, raw: string): BugStyleFinding | ScribeRecommendation | null {
  const parsed = parseRawJsonObject(raw);
  if (!parsed) return null;

  if (persona === "scribe") {
    const functionName = safeString(parsed.functionName);
    const reason = safeString(parsed.reason);
    const testTypeRaw = safeString(parsed.testType).toLowerCase();
    const priorityRaw = safeString(parsed.priority);
    const confidence = clampConfidence(Number(parsed.confidence ?? 0.7));

    const testType = testTypeRaw === "integration" || testTypeRaw === "e2e"
      ? testTypeRaw
      : "unit";

    if (!functionName || !reason) return null;

    return {
      functionName,
      reason,
      testType,
      priority: normalizePriority(priorityRaw || "HIGH"),
      confidence,
    };
  }

  const findingValue = parsed.finding;
  const finding = typeof findingValue === "string" ? findingValue.trim() : null;
  const lineReference = safeString(parsed.lineReference) || null;
  const functionName = safeString(parsed.functionName) || null;
  const severity = normalizeSeverity(safeString(parsed.severity) || "LOW");
  const confidence = clampConfidence(Number(parsed.confidence ?? 0));

  const cveReference = safeString(parsed.cveReference) || null;
  const estimatedPerformanceImpact = safeString(parsed.estimatedPerformanceImpact) || null;
  const couplingImports = Array.isArray(parsed.couplingImports)
    ? parsed.couplingImports
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];

  return {
    finding: finding && finding.length > 0 ? finding : null,
    lineReference,
    severity,
    confidence,
    functionName,
    cveReference,
    estimatedPerformanceImpact,
    couplingImports,
  };
}

export function shouldApplyGenericPenalty(input: GenericFindingInput): boolean {
  const findingText = safeString(input.findingText);
  if (!findingText) return true;

  const shortFinding = countWords(findingText) < 15;
  if (!shortFinding) return false;

  const hasFunction = hasFunctionReference(input.functionName ?? null, findingText);
  const hasLine = hasLineReference(input.lineReference ?? null, findingText);
  return !hasFunction && !hasLine;
}

export function isGenericFinding(input: GenericFindingInput): boolean {
  const findingText = safeString(input.findingText);
  if (!findingText) return true;
  if (countWords(findingText) >= 10) return false;

  const hasFunction = hasFunctionReference(input.functionName ?? null, findingText);
  const hasLine = hasLineReference(input.lineReference ?? null, findingText);
  const hasPattern = hasSpecificPatternName(findingText);
  const hasKeyword = hasCodeKeyword(findingText);

  return !hasFunction && !hasLine && !hasPattern && !hasKeyword;
}

export function isSecurityAdjacentFinding(params: {
  filePath: string;
  finding: string | null;
  functionName: string | null;
}): boolean {
  const haystack = `${params.filePath} ${params.finding ?? ""} ${params.functionName ?? ""}`.toLowerCase();
  const markers = ["auth", "token", "jwt", "secret", "permission", "xss", "sql", "inject", "csrf", "endpoint"];
  return markers.some(marker => haystack.includes(marker));
}

export function toMemoryPattern(params: {
  persona: AgentPersona;
  filePath: string;
  finding: string;
  functionName?: string | null;
}): string {
  const fn = params.functionName?.trim() ? ` function=${params.functionName?.trim()}` : "";
  return normalizePattern(`${params.persona} ${extractFileType(params.filePath)} ${params.finding}${fn}`);
}

export function calibrateConfidence(input: CalibrationInput): CalibrationResult {
  let score = clampConfidence(input.baseConfidence);
  const modifiers: string[] = [];

  if (input.personalPatternMatch) {
    score += 0.10;
    modifiers.push("+0.10 personal_kb_pattern");
  }

  // Personal memory recognition from repeated experience (fix #3) in addition to calibration rules.
  if (input.personalExperienceMatch) {
    score += 0.05;
    modifiers.push("+0.05 personal_experience");
  }

  if (input.sharedPatternMatch) {
    score += 0.10;
    modifiers.push("+0.10 shared_kb_pattern");
  }

  if (input.accuracy > 0.85) {
    score += 0.05;
    modifiers.push("+0.05 high_agent_accuracy");
  }

  if (input.accuracy < 0.60) {
    score -= 0.10;
    modifiers.push("-0.10 low_agent_accuracy");
  }

  if (input.genericFinding) {
    score -= 0.20;
    modifiers.push("-0.20 generic_short_without_location");
  }

  score = clampConfidence(score);

  if (score < DISCARD_THRESHOLD) {
    return {
      before: clampConfidence(input.baseConfidence),
      after: score,
      modifiers,
      classification: "discarded",
    };
  }

  if (score < OBSERVATION_THRESHOLD) {
    return {
      before: clampConfidence(input.baseConfidence),
      after: score,
      modifiers,
      classification: "observation",
    };
  }

  if (score < BUG_THRESHOLD) {
    return {
      before: clampConfidence(input.baseConfidence),
      after: score,
      modifiers,
      classification: "observation",
    };
  }

  return {
    before: clampConfidence(input.baseConfidence),
    after: score,
    modifiers,
    classification: "bug",
  };
}
