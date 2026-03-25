/**
 * Analysis Tools — Part 9 of the CodeCity Intelligence Master Plan.
 *
 * Provides static analysis, complexity analysis, dependency analysis,
 * security analysis, test coverage analysis, performance analysis,
 * documentation analysis, and architecture analysis capabilities.
 *
 * These tools are used by agents and the Mayor to produce actionable intelligence.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplexityResult {
  filePath: string;
  functions: FunctionComplexity[];
  fileComplexity: number;
  loc: number;
  nestingDepthMax: number;
}

export interface FunctionComplexity {
  name: string;
  line: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  loc: number;
  paramCount: number;
}

export interface SecurityFinding {
  filePath: string;
  line: number;
  rule: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  snippet: string;
}

export interface DependencyIssue {
  type: "circular" | "unused" | "duplicate";
  files: string[];
  detail: string;
}

export interface DocumentationGap {
  filePath: string;
  line: number;
  type: "missing-jsdoc" | "stale-comment" | "stale-todo" | "undocumented-export";
  functionName?: string;
  detail: string;
}

export interface ArchitectureSmell {
  filePath: string;
  type: "god-object" | "feature-envy" | "high-coupling" | "low-cohesion";
  score: number;
  detail: string;
}

// ── Complexity Analysis ──────────────────────────────────────────────────────

const BRANCH_KEYWORDS = /\b(if|else if|case|for|while|do|catch|\?\?|&&|\|\||\?)\b/g;
const FUNCTION_REGEX = /(?:(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>|(\w+)\s*\([^)]*\)\s*(?::\s*\w[^{]*)?{)/g;

/** Analyze complexity for a single file. */
export function analyzeComplexity(filePath: string, code?: string): ComplexityResult {
  const source = code ?? safeReadFile(filePath);
  if (!source) return { filePath, functions: [], fileComplexity: 0, loc: 0, nestingDepthMax: 0 };

  const lines = source.split("\n");
  const loc = lines.filter(l => l.trim().length > 0 && !l.trim().startsWith("//")).length;

  // File-level cyclomatic complexity
  const branches = source.match(BRANCH_KEYWORDS);
  const fileComplexity = 1 + (branches?.length ?? 0);

  // Max nesting depth
  let maxNesting = 0;
  let currentNesting = 0;
  for (const line of lines) {
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length;
    currentNesting += opens - closes;
    if (currentNesting > maxNesting) maxNesting = currentNesting;
  }

  // Function-level complexity
  const functions: FunctionComplexity[] = [];
  let match: RegExpExecArray | null;
  FUNCTION_REGEX.lastIndex = 0;
  while ((match = FUNCTION_REGEX.exec(source)) !== null) {
    const name = match[1] ?? match[2] ?? match[3] ?? "anonymous";
    const startIdx = match.index;
    const lineNum = source.slice(0, startIdx).split("\n").length;

    // Find function body extent
    const bodyStart = source.indexOf("{", startIdx);
    if (bodyStart < 0) continue;
    let depth = 0;
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
    const body = source.slice(bodyStart, bodyEnd + 1);
    const bodyBranches = body.match(BRANCH_KEYWORDS);
    const cc = 1 + (bodyBranches?.length ?? 0);
    const bodyLines = body.split("\n").filter(l => l.trim().length > 0).length;

    // Param count
    const paramMatch = source.slice(startIdx, bodyStart).match(/\(([^)]*)\)/);
    const paramCount = paramMatch?.[1]?.trim()
      ? paramMatch[1].split(",").filter(p => p.trim().length > 0).length
      : 0;

    // Cognitive complexity (simplified: nesting adds weight)
    let cognitive = 0;
    let nestLevel = 0;
    for (const bLine of body.split("\n")) {
      const trimmed = bLine.trim();
      if (/^(if|for|while|switch)\b/.test(trimmed)) cognitive += 1 + nestLevel;
      if (/^(else if|else)\b/.test(trimmed)) cognitive += 1;
      const o = (bLine.match(/{/g) ?? []).length;
      const c = (bLine.match(/}/g) ?? []).length;
      nestLevel += o - c;
    }

    functions.push({
      name,
      line: lineNum,
      cyclomaticComplexity: cc,
      cognitiveComplexity: cognitive,
      loc: bodyLines,
      paramCount,
    });
  }

  return { filePath, functions, fileComplexity, loc, nestingDepthMax: maxNesting };
}

// ── Security Analysis ────────────────────────────────────────────────────────

interface SecurityRule {
  id: string;
  pattern: RegExp;
  severity: SecurityFinding["severity"];
  message: string;
}

const SECURITY_RULES: SecurityRule[] = [
  { id: "hardcoded-secret", pattern: /(?:password|secret|api_key|apikey|token)\s*[:=]\s*["'][^"']{8,}["']/gi, severity: "critical", message: "Potential hardcoded secret detected" },
  { id: "eval-usage", pattern: /\beval\s*\(/g, severity: "high", message: "Unsafe eval() usage" },
  { id: "innerhtml", pattern: /\.innerHTML\s*=/g, severity: "medium", message: "Direct innerHTML assignment — potential XSS" },
  { id: "sql-concat", pattern: /(?:query|execute|raw|sql)\s*\(\s*[`"'].*\$\{/g, severity: "high", message: "Potential SQL injection via string interpolation" },
  { id: "no-auth-check", pattern: /app\.(get|post|put|patch|delete)\s*\(\s*["'][^"']+["']\s*,\s*(?:async\s+)?\([^)]*\)\s*=>/g, severity: "low", message: "Route handler without visible middleware — verify auth" },
  { id: "insecure-random", pattern: /Math\.random\(\)/g, severity: "medium", message: "Math.random() is not cryptographically secure" },
  { id: "console-error-leak", pattern: /console\.(log|error|warn)\(.*(password|secret|token|api.?key)/gi, severity: "medium", message: "Sensitive data may be logged to console" },
  { id: "exec-usage", pattern: /\bexec\s*\(|execSync\s*\(/g, severity: "high", message: "Shell command execution — verify input is sanitized" },
];

/** Scan a file for security vulnerabilities. */
export function analyzeSecurityFile(filePath: string, code?: string): SecurityFinding[] {
  const source = code ?? safeReadFile(filePath);
  if (!source) return [];

  const findings: SecurityFinding[] = [];
  const lines = source.split("\n");

  for (const rule of SECURITY_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(source)) !== null) {
      const lineNum = source.slice(0, m.index).split("\n").length;
      const snippet = lines[lineNum - 1]?.trim().slice(0, 120) ?? "";
      findings.push({
        filePath,
        line: lineNum,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        snippet,
      });
    }
  }

  return findings;
}

/** Scan all TS/JS files in a directory for security issues. */
export function analyzeSecurityDirectory(rootDir: string, maxFiles = 200): SecurityFinding[] {
  const files = collectSourceFiles(rootDir, maxFiles);
  return files.flatMap(f => analyzeSecurityFile(f));
}

// ── Documentation Analysis ───────────────────────────────────────────────────

const EXPORT_REGEX = /^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+(\w+)/gm;
const JSDOC_REGEX = /\/\*\*[\s\S]*?\*\//;
const TODO_REGEX = /\/\/\s*(TODO|FIXME|HACK|XXX)\b(.*)/gi;

/** Analyze documentation quality for a file. */
export function analyzeDocumentation(filePath: string, code?: string): DocumentationGap[] {
  const source = code ?? safeReadFile(filePath);
  if (!source) return [];

  const gaps: DocumentationGap[] = [];
  const lines = source.split("\n");

  // Undocumented exports
  EXPORT_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPORT_REGEX.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length;
    // Check if preceded by JSDoc
    const precedingLines = lines.slice(Math.max(0, lineNum - 6), lineNum - 1).join("\n");
    if (!JSDOC_REGEX.test(precedingLines)) {
      gaps.push({
        filePath,
        line: lineNum,
        type: "undocumented-export",
        functionName: m[1],
        detail: `Exported symbol '${m[1]}' has no JSDoc comment`,
      });
    }
  }

  // Stale TODOs
  TODO_REGEX.lastIndex = 0;
  while ((m = TODO_REGEX.exec(source)) !== null) {
    const lineNum = source.slice(0, m.index).split("\n").length;
    gaps.push({
      filePath,
      line: lineNum,
      type: "stale-todo",
      detail: `${m[1]}: ${m[2]?.trim() ?? "(no description)"}`,
    });
  }

  return gaps;
}

// ── Architecture Analysis ────────────────────────────────────────────────────

const IMPORT_REGEX = /(?:import\s+.*from\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\))/g;

/** Analyze architecture smells for a file based on its imports and exports. */
export function analyzeArchitecture(filePath: string, code?: string): ArchitectureSmell[] {
  const source = code ?? safeReadFile(filePath);
  if (!source) return [];

  const smells: ArchitectureSmell[] = [];

  // Collect imports
  const imports: string[] = [];
  IMPORT_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_REGEX.exec(source)) !== null) {
    imports.push(m[1] ?? m[2]);
  }

  // God object: too many exports + too many lines
  const exportCount = (source.match(/^export\s+/gm) ?? []).length;
  const loc = source.split("\n").length;
  if (exportCount > 15 && loc > 500) {
    smells.push({
      filePath,
      type: "god-object",
      score: Math.min(1, (exportCount / 30) * (loc / 1000)),
      detail: `${exportCount} exports across ${loc} lines — consider splitting`,
    });
  }

  // High coupling: too many imports
  if (imports.length > 15) {
    smells.push({
      filePath,
      type: "high-coupling",
      score: Math.min(1, imports.length / 30),
      detail: `${imports.length} imports — high coupling risk`,
    });
  }

  // Feature envy: more external module references than internal
  const relativeImports = imports.filter(i => i.startsWith("."));
  const externalImports = imports.filter(i => !i.startsWith("."));
  if (relativeImports.length > 5 && relativeImports.length > externalImports.length * 2) {
    smells.push({
      filePath,
      type: "feature-envy",
      score: Math.min(1, relativeImports.length / 20),
      detail: `${relativeImports.length} relative imports vs ${externalImports.length} external — may be doing too much`,
    });
  }

  return smells;
}

// ── Batch Analysis ───────────────────────────────────────────────────────────

export interface FullAnalysisReport {
  complexity: ComplexityResult[];
  security: SecurityFinding[];
  documentation: DocumentationGap[];
  architecture: ArchitectureSmell[];
  summary: {
    totalFiles: number;
    avgComplexity: number;
    securityIssues: number;
    docGaps: number;
    archSmells: number;
    highRiskFiles: string[];
  };
}

/** Run all analysis tools on a directory. */
export function runFullAnalysis(rootDir: string, maxFiles = 200): FullAnalysisReport {
  const files = collectSourceFiles(rootDir, maxFiles);

  const complexity = files.map(f => analyzeComplexity(f));
  const security = files.flatMap(f => analyzeSecurityFile(f));
  const documentation = files.flatMap(f => analyzeDocumentation(f));
  const architecture = files.flatMap(f => analyzeArchitecture(f));

  const avgComplexity = complexity.length > 0
    ? complexity.reduce((s, c) => s + c.fileComplexity, 0) / complexity.length
    : 0;

  // High-risk: high complexity + security findings + no docs
  const riskScores = new Map<string, number>();
  for (const c of complexity) {
    riskScores.set(c.filePath, (riskScores.get(c.filePath) ?? 0) + c.fileComplexity / 10);
  }
  for (const s of security) {
    const w = s.severity === "critical" ? 4 : s.severity === "high" ? 3 : s.severity === "medium" ? 2 : 1;
    riskScores.set(s.filePath, (riskScores.get(s.filePath) ?? 0) + w);
  }
  for (const d of documentation) {
    riskScores.set(d.filePath, (riskScores.get(d.filePath) ?? 0) + 0.5);
  }

  const highRiskFiles = [...riskScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([f]) => f);

  return {
    complexity,
    security,
    documentation,
    architecture,
    summary: {
      totalFiles: files.length,
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      securityIssues: security.length,
      docGaps: documentation.length,
      archSmells: architecture.length,
      highRiskFiles,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);

function collectSourceFiles(dir: string, maxFiles: number): string[] {
  const result: string[] = [];

  function walk(d: string): void {
    if (result.length >= maxFiles) return;
    if (!existsSync(d)) return;
    const entries = readdirSync(d);
    for (const entry of entries) {
      if (result.length >= maxFiles) return;
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "build") continue;
      const full = join(d, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (SOURCE_EXTENSIONS.has(extname(entry).toLowerCase())) {
          result.push(full);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  walk(dir);
  return result;
}
