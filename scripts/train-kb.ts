#!/usr/bin/env tsx
/**
 * Pre-warm the knowledge base by running analysis on popular public repos.
 * Usage: pnpm train-kb
 * Runs for ~10 minutes. Adds real patterns to the KB.
 */
import { createClient } from "@libsql/client";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, "artifacts/api-server/data/city.db");

const db = createClient({ url: `file:${DB_PATH}` });

const REPOS_TO_ANALYZE = [
  "https://api.github.com/repos/expressjs/express/git/trees/master?recursive=1",
  "https://api.github.com/repos/axios/axios/git/trees/main?recursive=1",
  "https://api.github.com/repos/lodash/lodash/git/trees/main?recursive=1",
];

interface RepoTreeItem {
  path?: string;
  type?: string;
  size?: number;
}

interface RepoTreeResponse {
  tree?: RepoTreeItem[];
}

interface RepoIdentity {
  owner: string;
  repo: string;
  branch: string;
  slug: string;
}

interface FileCandidate {
  path: string;
  size: number;
}

interface KnowledgeInsertRow {
  problemType: string;
  language: string;
  question: string;
  answer: string;
  codeSnippet: string;
  patternTags: string[];
  actionItems: string[];
  confidence: string;
  provider: string;
  contextHash: string;
  qualityScore: number;
}

function parseRepoIdentity(apiTreeUrl: string): RepoIdentity {
  const match = apiTreeUrl.match(/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^?]+)/);
  if (!match) {
    throw new Error(`Cannot parse repository URL: ${apiTreeUrl}`);
  }
  const owner = match[1];
  const repo = match[2];
  const branch = match[3];
  return { owner, repo, branch, slug: `${owner}/${repo}` };
}

function shouldAnalyzeFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const isCodeFile = lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".py");
  if (!isCodeFile) return false;
  if (lower.includes("node_modules/")) return false;
  if (lower.includes("/dist/") || lower.startsWith("dist/")) return false;
  if (lower.includes("/__tests__/")) return false;
  if (lower.includes("/tests/") || lower.startsWith("tests/")) return false;
  if (lower.includes("/test/") || lower.startsWith("test/")) return false;
  if (lower.endsWith(".spec.ts") || lower.endsWith(".spec.js") || lower.endsWith(".test.ts") || lower.endsWith(".test.js")) return false;
  return true;
}

function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".py")) return "python";
  return "unknown";
}

function countLoc(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function shortFileName(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  if (idx === -1) return filePath;
  return filePath.slice(idx + 1);
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function extractFunctionNames(content: string, language: string): string[] {
  const names = new Set<string>();

  if (language === "python") {
    const pyRegex = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
    let m: RegExpExecArray | null = pyRegex.exec(content);
    while (m) {
      names.add(m[1]);
      m = pyRegex.exec(content);
    }
  } else {
    const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let m: RegExpExecArray | null = fnRegex.exec(content);
    while (m) {
      names.add(m[1]);
      m = fnRegex.exec(content);
    }

    const constFnRegex = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g;
    m = constFnRegex.exec(content);
    while (m) {
      names.add(m[1]);
      m = constFnRegex.exec(content);
    }
  }

  return Array.from(names);
}

function hasAsyncWithoutTry(content: string, language: string): boolean {
  if (language === "python") {
    const hasAsyncDef = /async\s+def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(content);
    return hasAsyncDef && !/\btry\s*:/.test(content);
  }

  const hasAsyncFunction = /async\s+(?:function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(|\([^)]+\)\s*=>|\([^)]*\)\s*=>)/.test(content);
  return hasAsyncFunction && !/\btry\s*\{/.test(content);
}

function hasFunctionLongerThan50Lines(content: string, language: string): boolean {
  if (language === "python") {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(lines[i])) continue;
      const baseIndent = (lines[i].match(/^\s*/) ?? [""])[0].length;
      let length = 0;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        const indent = (line.match(/^\s*/) ?? [""])[0].length;
        if (line.trim() !== "" && indent <= baseIndent) break;
        length++;
      }
      if (length > 50) return true;
    }
    return false;
  }

  const blockRegex = /(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null = blockRegex.exec(content);
  while (m) {
    const blockLines = m[1].split(/\r?\n/).length;
    if (blockLines > 50) return true;
    m = blockRegex.exec(content);
  }
  return false;
}

function lacksInputValidation(content: string, language: string, functionNames: string[]): boolean {
  if (functionNames.length === 0) return false;

  const hasValidationSignals =
    /\bzod\b|\bjoi\b|\byup\b|\bvalidator\b|\bschema\b|\bsanitize\b|\bparse\(/i.test(content) ||
    /if\s*\(\s*!\s*[A-Za-z_$][A-Za-z0-9_$]*/.test(content) ||
    (language === "python" && /\bpydantic\b|\btyping\b|\bassert\b|\bisinstance\(/i.test(content));

  return !hasValidationSignals;
}

function buildRows(repoSlug: string, filePath: string, content: string, language: string, loc: number): KnowledgeInsertRow[] {
  const rows: KnowledgeInsertRow[] = [];
  const functionNames = extractFunctionNames(content, language);
  const snippet = content.slice(0, 1200);

  if (hasAsyncWithoutTry(content, language)) {
    rows.push({
      problemType: "error_handling",
      language,
      question: `${repoSlug}:${filePath} appears to contain async logic without explicit error handling.`,
      answer: "Add explicit error handling around async boundaries and return deterministic error responses to avoid silent failures.",
      codeSnippet: snippet,
      patternTags: ["async", "error-handling", "missing-try-catch"],
      actionItems: ["Add try/catch around async code", "Log context-rich errors", "Add failure-path tests"],
      confidence: "medium",
      provider: "trainer",
      contextHash: hashText(`${repoSlug}:${filePath}:async-error`),
      qualityScore: 0.62,
    });
  }

  if (hasFunctionLongerThan50Lines(content, language)) {
    rows.push({
      problemType: "complexity",
      language,
      question: `${repoSlug}:${filePath} has function blocks longer than 50 lines (LOC ${loc}).`,
      answer: "Large functions are a complexity risk. Split into smaller units, isolate side effects, and add targeted tests per branch.",
      codeSnippet: snippet,
      patternTags: ["complexity", "long-function", "maintainability"],
      actionItems: ["Extract helper functions", "Reduce branching per function", "Add focused unit tests"],
      confidence: "medium",
      provider: "trainer",
      contextHash: hashText(`${repoSlug}:${filePath}:long-function`),
      qualityScore: 0.6,
    });
  }

  if (lacksInputValidation(content, language, functionNames)) {
    rows.push({
      problemType: "input_validation",
      language,
      question: `${repoSlug}:${filePath} exports functions with limited visible input validation.`,
      answer: "Validate external inputs at module boundaries. Reject malformed data early and keep internal assumptions explicit.",
      codeSnippet: snippet,
      patternTags: ["validation", "api-boundary", "defensive-coding"],
      actionItems: ["Add schema validation", "Reject unknown fields", "Add negative validation tests"],
      confidence: "low",
      provider: "trainer",
      contextHash: hashText(`${repoSlug}:${filePath}:input-validation`),
      qualityScore: 0.56,
    });
  }

  return rows;
}

function toRawFileUrl(identity: RepoIdentity, filePath: string): string {
  const encodedPath = filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://raw.githubusercontent.com/${identity.owner}/${identity.repo}/${identity.branch}/${encodedPath}`;
}

async function resolveKnowledgeTableName(): Promise<"knowledge" | "knowledge_entries"> {
  const rows = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge', 'knowledge_entries') ORDER BY CASE name WHEN 'knowledge' THEN 0 ELSE 1 END LIMIT 1");
  const tableName = String(rows.rows[0]?.name ?? "knowledge");
  return tableName === "knowledge_entries" ? "knowledge_entries" : "knowledge";
}

async function insertRow(tableName: "knowledge" | "knowledge_entries", row: KnowledgeInsertRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${tableName} (problem_type, language, framework, pattern_tags, file_type, question, context_hash, code_snippet, answer, action_items, confidence, provider, use_count, was_useful, produced_bugs, quality_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.problemType,
      row.language,
      null,
      JSON.stringify(row.patternTags),
      "source",
      row.question,
      row.contextHash,
      row.codeSnippet,
      row.answer,
      JSON.stringify(row.actionItems),
      row.confidence,
      row.provider,
      1,
      1,
      0,
      row.qualityScore,
    ],
  );
}

async function analyzeRepo(tableName: "knowledge" | "knowledge_entries", apiTreeUrl: string): Promise<number> {
  const identity = parseRepoIdentity(apiTreeUrl);
  console.log(`${identity.slug}: fetching files...`);

  const treeRes = await fetch(apiTreeUrl, { signal: AbortSignal.timeout(20000) });
  if (!treeRes.ok) {
    throw new Error(`Tree fetch failed (${treeRes.status})`);
  }

  const treeData = (await treeRes.json()) as RepoTreeResponse;
  const candidates: FileCandidate[] = (treeData.tree ?? [])
    .filter((item) => item.type === "blob" && !!item.path && typeof item.size === "number")
    .map((item) => ({ path: String(item.path), size: Number(item.size) }))
    .filter((item) => shouldAnalyzeFile(item.path))
    .sort((a, b) => b.size - a.size)
    .slice(0, 15);

  let repoAdded = 0;

  for (const file of candidates) {
    const rawUrl = toRawFileUrl(identity, file.path);
    const contentRes = await fetch(rawUrl, { signal: AbortSignal.timeout(20000) });
    if (!contentRes.ok) continue;

    const content = await contentRes.text();
    const loc = countLoc(content);
    console.log(`${identity.slug}: analyzing ${shortFileName(file.path)} (${loc} LOC)...`);

    const language = detectLanguage(file.path);
    const rows = buildRows(identity.slug, file.path, content, language, loc);

    for (const row of rows) {
      try {
        await insertRow(tableName, row);
        repoAdded++;
      } catch {
        // Skip duplicate or malformed rows without aborting training.
      }
    }
  }

  console.log(`${identity.slug}: added ${repoAdded} KB entries`);
  return repoAdded;
}

async function main(): Promise<void> {
  const tableName = await resolveKnowledgeTableName();
  console.log(`Using DB: ${DB_PATH}`);
  console.log(`Target table: ${tableName}`);

  let totalAdded = 0;

  for (const apiTreeUrl of REPOS_TO_ANALYZE) {
    try {
      totalAdded += await analyzeRepo(tableName, apiTreeUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const identity = parseRepoIdentity(apiTreeUrl);
      console.log(`${identity.slug}: skipped (${message})`);
    }
  }

  console.log(`Training complete. Added ${totalAdded} entries to knowledge base.`);
  console.log("Run pnpm seed-kb to add hand-crafted seed patterns too.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
