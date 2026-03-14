#!/usr/bin/env node
// seed-knowledge.ts: CLI to import knowledge entries from a JSON file
import fs from "fs";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "url";
import { dirname, isAbsolute, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, "artifacts/api-server/data/city.db");
const db = createClient({ url: `file:${DB_PATH}` });

interface SeedEntry {
  problemType?: string;
  language?: string;
  framework?: string | null;
  patternTags?: string[] | string | null;
  fileType?: string | null;
  question: string;
  contextHash?: string | null;
  codeSnippet?: string | null;
  answer: string;
  actionItems?: string[] | string | null;
  confidence?: string;
  provider?: string;
  useCount?: number;
  wasUseful?: number;
  producedBugs?: number;
  qualityScore?: number;
}

const DEFAULT_SEED_ENTRIES: SeedEntry[] = [
  {
    problemType: "test_generation",
    language: "typescript",
    framework: "express",
    patternTags: ["async", "error-handling"],
    fileType: "api",
    question: "How do I reliably test async route handlers with failures?",
    answer: "Wrap async handlers in try/catch, mock failures deterministically, and assert both status code and error payload shape.",
    actionItems: ["Add failing-path tests", "Assert error payload contract", "Mock async rejection"],
    confidence: "high",
    provider: "seed",
    useCount: 1,
    wasUseful: 1,
    producedBugs: 0,
    qualityScore: 0.7,
  },
  {
    problemType: "bug_analysis",
    language: "javascript",
    framework: "node",
    patternTags: ["race-condition", "promise"],
    fileType: "source",
    question: "Why does state look undefined right after an async call?",
    answer: "The read happens before the async write completes. Await the promise or move reads into the callback chain.",
    actionItems: ["Await pending promises", "Remove shared mutable state"],
    confidence: "high",
    provider: "seed",
    useCount: 1,
    wasUseful: 1,
    producedBugs: 0,
    qualityScore: 0.72,
  },
  {
    problemType: "security",
    language: "python",
    framework: "fastapi",
    patternTags: ["validation", "input-safety"],
    fileType: "api",
    question: "What is a safe baseline for request validation?",
    answer: "Validate request schema at boundaries, reject unknown fields, and sanitize high-risk inputs before persistence.",
    actionItems: ["Use strict schema", "Reject unknown fields", "Add negative tests"],
    confidence: "medium",
    provider: "seed",
    useCount: 1,
    wasUseful: 1,
    producedBugs: 0,
    qualityScore: 0.66,
  },
];

function resolveInputPath(inputPath: string): string {
  if (isAbsolute(inputPath)) return inputPath;
  return join(REPO_ROOT, inputPath);
}

async function resolveKnowledgeTableName(): Promise<"knowledge" | "knowledge_entries"> {
  const rows = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge', 'knowledge_entries') ORDER BY CASE name WHEN 'knowledge' THEN 0 ELSE 1 END LIMIT 1");
  const tableName = String(rows.rows[0]?.name ?? "knowledge");
  return tableName === "knowledge_entries" ? "knowledge_entries" : "knowledge";
}

function normalizeEntries(parsed: unknown): SeedEntry[] {
  if (Array.isArray(parsed)) {
    return parsed as SeedEntry[];
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return (parsed as { entries: SeedEntry[] }).entries;
  }
  return [];
}

async function main() {
  const tableName = await resolveKnowledgeTableName();
  const file = process.argv[2];
  let entries: SeedEntry[] = DEFAULT_SEED_ENTRIES;
  let source = "built-in defaults";

  if (file) {
    const abs = resolveInputPath(file);
    if (!fs.existsSync(abs)) {
      console.error(`File not found: ${abs}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(abs, "utf-8");
    try {
      const parsed = JSON.parse(raw);
      entries = normalizeEntries(parsed);
      source = abs;
    } catch {
      console.error(`Invalid JSON file: ${abs}`);
      process.exit(1);
    }
  }

  if (entries.length === 0) {
    console.log(`No entries to import from ${source}.`);
    return;
  }

  console.log(`Using DB: ${DB_PATH}`);
  console.log(`Seeding from: ${source}`);

  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      if (!entry.question || !entry.answer) {
        skipped++;
        continue;
      }

      await db.execute(
        `INSERT INTO ${tableName} (problem_type, language, framework, pattern_tags, file_type, question, context_hash, code_snippet, answer, action_items, confidence, provider, use_count, was_useful, produced_bugs, quality_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(entry.problemType ?? "unknown"),
          String(entry.language ?? "unknown"),
          entry.framework ? String(entry.framework) : null,
          entry.patternTags ? (typeof entry.patternTags === "string" ? entry.patternTags : JSON.stringify(entry.patternTags)) : null,
          entry.fileType ? String(entry.fileType) : null,
          String(entry.question ?? ""),
          entry.contextHash ? String(entry.contextHash) : null,
          entry.codeSnippet ? String(entry.codeSnippet) : null,
          String(entry.answer ?? ""),
          entry.actionItems ? (typeof entry.actionItems === "string" ? entry.actionItems : JSON.stringify(entry.actionItems)) : null,
          ["high", "medium", "low"].includes(String(entry.confidence)) ? String(entry.confidence) : "medium",
          String(entry.provider ?? "import"),
          typeof entry.useCount === "number" ? entry.useCount : 1,
          typeof entry.wasUseful === "number" ? entry.wasUseful : 1,
          typeof entry.producedBugs === "number" ? entry.producedBugs : 0,
          typeof entry.qualityScore === "number" ? Math.min(1, Math.max(0, entry.qualityScore)) : 0.5,
        ]
      );
      imported++;
    } catch {
      skipped++;
    }
  }

  console.log(`Imported: ${imported}, Skipped: ${skipped}, Total: ${entries.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
