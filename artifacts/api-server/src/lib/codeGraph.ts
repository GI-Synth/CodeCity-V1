import { db } from "@workspace/db";
import {
  codeGraphNodesTable,
  codeGraphEdgesTable,
  type CodeGraphNode,
  type CodeGraphEdge,
} from "@workspace/db/schema";
import { eq, gt, and, lt, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────

export interface GraphSummary {
  totalNodes: number;
  totalEdges: number;
  circularCount: number;
  avgComplexity: number;
  avgCoverage: number | null;
}

// ─── File scanning ──────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".turbo", ".cache", ".pnpm", "vendor", "__pycache__",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
]);

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        results.push(...walkFiles(fullPath));
      }
    } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Import parsing (regex-based) ──────────────────────────────────

const IMPORT_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
const EXPORT_RE = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract)\s+(\w+)/g;
const FUNCTION_RE = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>)/g;

function parseImports(source: string): string[] {
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(IMPORT_RE.source, "g");
  while ((match = re.exec(source)) !== null) {
    const specifier = match[1] || match[2];
    if (specifier && !specifier.startsWith(".") === false) {
      imports.push(specifier);
    } else if (specifier) {
      imports.push(specifier);
    }
  }
  return imports;
}

function countExports(source: string): number {
  const re = new RegExp(EXPORT_RE.source, "g");
  let count = 0;
  while (re.exec(source)) count++;
  return count;
}

function getExportNames(source: string): string[] {
  const names: string[] = [];
  const re = new RegExp(EXPORT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

// ─── Complexity scoring ─────────────────────────────────────────────

function computeComplexity(source: string): { cyclomatic: number; cognitive: number } {
  const lines = source.split("\n");
  let cyclomatic = 1;
  let cognitive = 0;
  let nestingDepth = 0;

  const branchKeywords = /\b(if|else\s+if|switch|case|for|while|do|catch|\?\?|&&|\|\|)\b/g;
  const nestingOpeners = /[{(]/g;
  const nestingClosers = /[})]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed === "") continue;

    // Count branch keywords for cyclomatic
    const branchMatches = trimmed.match(branchKeywords);
    if (branchMatches) {
      cyclomatic += branchMatches.length;
      cognitive += branchMatches.length * (1 + nestingDepth * 0.5);
    }

    // Track nesting
    const openers = (trimmed.match(nestingOpeners) || []).length;
    const closers = (trimmed.match(nestingClosers) || []).length;
    nestingDepth = Math.max(0, nestingDepth + openers - closers);
  }

  // Normalize to 0-100
  const normalizedCyclomatic = Math.min(100, Math.round(cyclomatic * 2));
  const normalizedCognitive = Math.min(100, Math.round(cognitive));

  return { cyclomatic: normalizedCyclomatic, cognitive: normalizedCognitive };
}

// ─── Import resolution ──────────────────────────────────────────────

function resolveImportPath(fromFile: string, importSpecifier: string, projectRoot: string): string | null {
  // Skip bare node_modules imports
  if (!importSpecifier.startsWith(".") && !importSpecifier.startsWith("/")) {
    // Could be a workspace alias like @workspace/db
    if (importSpecifier.startsWith("@workspace/")) return null;
    return null; // external module
  }

  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importSpecifier);

  // Try extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return path.relative(projectRoot, resolved);
  }

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(projectRoot, candidate);
    }
  }

  return null;
}

// ─── Circular dependency detection (DFS) ────────────────────────────

function detectCircularDeps(adjacency: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stackPath: string[] = [];

  function dfs(node: string) {
    if (inStack.has(node)) {
      // Found cycle
      const cycleStart = stackPath.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(stackPath.slice(cycleStart).concat(node));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    stackPath.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      dfs(neighbor);
    }

    stackPath.pop();
    inStack.delete(node);
  }

  for (const node of adjacency.keys()) {
    dfs(node);
  }

  // Deduplicate cycles (normalize by sorting and stringifying)
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const cycle of cycles) {
    const normalized = [...cycle.slice(0, -1)]; // remove trailing duplicate
    const minIdx = normalized.indexOf(
      normalized.reduce((min, cur) => (cur < min ? cur : min), normalized[0])
    );
    const rotated = [...normalized.slice(minIdx), ...normalized.slice(0, minIdx)];
    const key = rotated.join(" -> ");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(rotated);
    }
  }

  return unique;
}

// ─── Graph builder ──────────────────────────────────────────────────

export async function buildCodeGraph(projectRoot: string): Promise<{
  nodesInserted: number;
  edgesInserted: number;
  circularDeps: number;
}> {
  const now = Date.now();
  const files = walkFiles(projectRoot);

  // Parse all files
  const fileData = new Map<string, {
    relPath: string;
    source: string;
    imports: string[];
    exportCount: number;
    exportNames: string[];
    complexity: { cyclomatic: number; cognitive: number };
    loc: number;
  }>();

  for (const filePath of files) {
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const relPath = path.relative(projectRoot, filePath);
    const imports = parseImports(source);
    const exportCount = countExports(source);
    const exportNames = getExportNames(source);
    const complexity = computeComplexity(source);
    const loc = source.split("\n").length;

    fileData.set(relPath, { relPath, source, imports, exportCount, exportNames, complexity, loc });
  }

  // Build adjacency for import resolution
  const adjacency = new Map<string, string[]>();
  const edgeList: { from: string; to: string; type: string }[] = [];

  // Track which files are imported (for dead code + import_count)
  const importedBy = new Map<string, Set<string>>();

  for (const [relPath, data] of fileData) {
    const resolvedImports: string[] = [];
    const fullPath = path.join(projectRoot, relPath);

    for (const imp of data.imports) {
      const resolved = resolveImportPath(fullPath, imp, projectRoot);
      if (resolved && fileData.has(resolved)) {
        resolvedImports.push(resolved);
        edgeList.push({ from: relPath, to: resolved, type: "imports" });

        if (!importedBy.has(resolved)) importedBy.set(resolved, new Set());
        importedBy.get(resolved)!.add(relPath);
      }
    }

    adjacency.set(relPath, resolvedImports);
  }

  // Detect circular dependencies
  const circles = detectCircularDeps(adjacency);
  const circularNodes = new Set<string>();
  for (const cycle of circles) {
    for (const node of cycle) circularNodes.add(node);
  }

  // Mark circular edges
  const circularEdges = new Set<string>();
  for (const cycle of circles) {
    for (let i = 0; i < cycle.length - 1; i++) {
      circularEdges.add(`${cycle[i]}|${cycle[i + 1]}`);
    }
  }

  // Find dead code: files with exports that are never imported
  const deadCodeFiles = new Set<string>();
  for (const [relPath, data] of fileData) {
    if (data.exportCount > 0 && !importedBy.has(relPath)) {
      // Has exports but nobody imports it
      // Exclude entry points (index.ts files, test files)
      const basename = path.basename(relPath);
      if (!basename.includes("index") && !basename.includes(".test.") && !basename.includes(".spec.")) {
        deadCodeFiles.add(relPath);
      }
    }
  }

  // Clear existing graph data
  await db.delete(codeGraphEdgesTable);
  await db.delete(codeGraphNodesTable);

  // Insert nodes
  let nodesInserted = 0;
  const nodeBatch: (typeof codeGraphNodesTable.$inferInsert)[] = [];

  for (const [relPath, data] of fileData) {
    const impCount = importedBy.get(relPath)?.size ?? 0;

    nodeBatch.push({
      id: relPath,
      nodeType: "file",
      name: path.basename(relPath),
      filePath: relPath,
      lineStart: 1,
      lineEnd: data.loc,
      complexityScore: data.complexity.cyclomatic,
      cognitiveComplexity: data.complexity.cognitive,
      loc: data.loc,
      testCoveragePct: null,
      isDeadCode: deadCodeFiles.has(relPath) ? 1 : 0,
      hasCircularDep: circularNodes.has(relPath) ? 1 : 0,
      importCount: impCount,
      exportCount: data.exportCount,
      lastAnalyzedAt: now,
      metadata: JSON.stringify({ exportNames: data.exportNames }),
    });
  }

  // Batch insert nodes (SQLite limit ~500 per INSERT)
  const BATCH_SIZE = 200;
  for (let i = 0; i < nodeBatch.length; i += BATCH_SIZE) {
    const batch = nodeBatch.slice(i, i + BATCH_SIZE);
    await db.insert(codeGraphNodesTable).values(batch);
    nodesInserted += batch.length;
  }

  // Insert edges
  let edgesInserted = 0;
  const edgeBatch: (typeof codeGraphEdgesTable.$inferInsert)[] = [];

  // Count edge weights (multiple imports from same pair)
  const edgeWeights = new Map<string, number>();
  for (const e of edgeList) {
    const key = `${e.from}|${e.to}|${e.type}`;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
  }

  const seenEdges = new Set<string>();
  for (const e of edgeList) {
    const key = `${e.from}|${e.to}|${e.type}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    const circularKey = `${e.from}|${e.to}`;
    edgeBatch.push({
      id: `edge-${edgeBatch.length}-${Date.now()}`,
      fromNode: e.from,
      toNode: e.to,
      edgeType: e.type,
      weight: edgeWeights.get(key) ?? 1,
      isCircular: circularEdges.has(circularKey) ? 1 : 0,
    });
  }

  for (let i = 0; i < edgeBatch.length; i += BATCH_SIZE) {
    const batch = edgeBatch.slice(i, i + BATCH_SIZE);
    await db.insert(codeGraphEdgesTable).values(batch);
    edgesInserted += batch.length;
  }

  console.log(`[CodeGraph] Built graph: ${nodesInserted} nodes, ${edgesInserted} edges, ${circles.length} circular deps`);
  return { nodesInserted, edgesInserted, circularDeps: circles.length };
}

// ─── Query functions ────────────────────────────────────────────────

export async function getNode(filePath: string): Promise<CodeGraphNode | null> {
  const rows = await db.select().from(codeGraphNodesTable).where(eq(codeGraphNodesTable.id, filePath)).limit(1);
  return rows[0] ?? null;
}

export async function getNeighbors(filePath: string): Promise<{
  imports: CodeGraphNode[];
  importedBy: CodeGraphNode[];
}> {
  const outgoing = await db.select().from(codeGraphEdgesTable)
    .where(eq(codeGraphEdgesTable.fromNode, filePath));

  const incoming = await db.select().from(codeGraphEdgesTable)
    .where(eq(codeGraphEdgesTable.toNode, filePath));

  const importIds = outgoing.map(e => e.toNode);
  const importedByIds = incoming.map(e => e.fromNode);

  const imports: CodeGraphNode[] = [];
  for (const id of importIds) {
    const node = await getNode(id);
    if (node) imports.push(node);
  }

  const importedBy: CodeGraphNode[] = [];
  for (const id of importedByIds) {
    const node = await getNode(id);
    if (node) importedBy.push(node);
  }

  return { imports, importedBy };
}

export async function getCircularDeps(): Promise<string[][]> {
  const circularEdges = await db.select().from(codeGraphEdgesTable)
    .where(eq(codeGraphEdgesTable.isCircular, 1));

  // Reconstruct cycles from circular edges
  const adjacency = new Map<string, string[]>();
  for (const edge of circularEdges) {
    if (!adjacency.has(edge.fromNode)) adjacency.set(edge.fromNode, []);
    adjacency.get(edge.fromNode)!.push(edge.toNode);
  }

  return detectCircularDeps(adjacency);
}

export async function getHighRiskFiles(): Promise<CodeGraphNode[]> {
  return db.select().from(codeGraphNodesTable)
    .where(
      and(
        gt(codeGraphNodesTable.complexityScore, 70),
        gt(codeGraphNodesTable.importCount, 5),
      )
    );
}

export async function getDeadCode(): Promise<CodeGraphNode[]> {
  return db.select().from(codeGraphNodesTable)
    .where(eq(codeGraphNodesTable.isDeadCode, 1));
}

export async function getGraphSummary(): Promise<GraphSummary> {
  const [nodeCount] = await db.select({ count: sql<number>`count(*)` }).from(codeGraphNodesTable);
  const [edgeCount] = await db.select({ count: sql<number>`count(*)` }).from(codeGraphEdgesTable);
  const [circularCount] = await db.select({ count: sql<number>`count(*)` }).from(codeGraphEdgesTable)
    .where(eq(codeGraphEdgesTable.isCircular, 1));
  const [avgResult] = await db.select({
    avgComplexity: sql<number>`avg(complexity_score)`,
    avgCoverage: sql<number | null>`avg(test_coverage_pct)`,
  }).from(codeGraphNodesTable);

  return {
    totalNodes: nodeCount?.count ?? 0,
    totalEdges: edgeCount?.count ?? 0,
    circularCount: circularCount?.count ?? 0,
    avgComplexity: Math.round(avgResult?.avgComplexity ?? 0),
    avgCoverage: avgResult?.avgCoverage ?? null,
  };
}
