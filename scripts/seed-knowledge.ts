#!/usr/bin/env tsx
// seed-knowledge.ts: CLI to import knowledge entries from a JSON file
import fs from "fs";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "url";
import { dirname, isAbsolute, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, "artifacts/api-server/data/city.db");
const db = createClient({ url: `file:${DB_PATH}` });

type SeedLanguage = "javascript" | "typescript" | "python" | "general";
type SeedProblemType = "bug_risk" | "security" | "performance" | "maintainability";

interface SeedEntry {
  language: SeedLanguage;
  problemType: SeedProblemType;
  question: string;
  answer: string;
  confidence: "high";
  provider: "seed";
  framework?: string | null;
  patternTags?: string[] | string | null;
  fileType?: string | null;
  contextHash?: string | null;
  codeSnippet?: string | null;
  actionItems?: string[] | string | null;
  useCount?: number;
  wasUseful?: number;
  producedBugs?: number;
  qualityScore?: number;
}

function seedEntry(entry: Omit<SeedEntry, "confidence" | "provider">): SeedEntry {
  return {
    confidence: "high",
    provider: "seed",
    useCount: 1,
    wasUseful: 1,
    producedBugs: 0,
    qualityScore: 0.82,
    ...entry,
  };
}

const DEFAULT_SEED_ENTRIES: SeedEntry[] = [
  seedEntry({
    language: "typescript",
    problemType: "bug_risk",
    patternTags: ["async", "promise", "error-handling"],
    question: "Async logic awaits operations without try/catch and can produce unhandled promise rejections.",
    answer: "Wrap awaited work in try/catch and surface controlled errors. Example:\nasync function runTask() {\n  try {\n    return await fetchData();\n  } catch (err) {\n    logger.error(err);\n    throw new Error('request_failed');\n  }\n}",
    actionItems: ["Add try/catch around await chains", "Log failures with context", "Test rejection paths"],
  }),
  seedEntry({
    language: "typescript",
    problemType: "bug_risk",
    patternTags: ["null-check", "optional-chaining"],
    question: "Property access occurs on possibly null or undefined values without a guard.",
    answer: "Guard nullable references or use optional chaining. Example:\nconst city = user?.profile?.city ?? 'unknown';\nif (!user) return;\nrender(user.profile.city);",
    actionItems: ["Add null checks", "Enable strictNullChecks", "Use optional chaining"],
  }),
  seedEntry({
    language: "javascript",
    problemType: "maintainability",
    patternTags: ["react", "useeffect", "dependencies"],
    question: "React useEffect callback uses changing values but dependency tracking is incomplete.",
    answer: "Include all referenced reactive values in the dependency array. Example:\nuseEffect(() => {\n  loadUser(userId);\n}, [userId]);",
    actionItems: ["Audit effect dependencies", "Enable react-hooks lint rules", "Avoid stale closures"],
  }),
  seedEntry({
    language: "javascript",
    problemType: "bug_risk",
    patternTags: ["react", "unmount", "state-update"],
    question: "State updates continue after component unmount and create leaks/warnings.",
    answer: "Cancel async work and gate updates with a mounted flag. Example:\nuseEffect(() => {\n  let alive = true;\n  fetchData().then((data) => { if (alive) setData(data); });\n  return () => { alive = false; };\n}, []);",
    actionItems: ["Add cleanup callbacks", "Cancel in-flight requests", "Block post-unmount state updates"],
  }),
  seedEntry({
    language: "javascript",
    problemType: "maintainability",
    patternTags: ["array", "foreach", "map"],
    question: "forEach is used where transformed return values are expected from each element.",
    answer: "Use map for value transformation pipelines. Example:\nconst names = users.map((u) => u.name);\n// avoid forEach when you need output values",
    actionItems: ["Replace forEach with map for transforms", "Return explicit values", "Test output shape"],
  }),
  seedEntry({
    language: "javascript",
    problemType: "bug_risk",
    patternTags: ["equality", "type-coercion"],
    question: "Loose equality (==) introduces coercion-driven branch bugs.",
    answer: "Use strict equality operators only. Example:\nif (status === 0) {\n  handleZero();\n}",
    actionItems: ["Replace == with ===", "Replace != with !==", "Add mixed-type test cases"],
  }),
  seedEntry({
    language: "javascript",
    problemType: "maintainability",
    patternTags: ["variables", "scope"],
    question: "var declarations expand scope and increase hoisting-related surprises.",
    answer: "Prefer const/let for block scoping and intent. Example:\nconst maxRetries = 3;\nlet retriesLeft = maxRetries;",
    actionItems: ["Replace var with const/let", "Use const by default", "Reduce mutable scope"],
  }),
  seedEntry({
    language: "javascript",
    problemType: "performance",
    patternTags: ["fs", "blocking-io", "event-loop"],
    question: "Synchronous file reads/writes are used in request or worker hot paths.",
    answer: "Use asynchronous filesystem APIs. Example:\nimport { readFile } from 'node:fs/promises';\nconst text = await readFile(filePath, 'utf8');",
    actionItems: ["Replace sync fs methods in hot paths", "Profile event loop delay", "Use fs/promises"],
  }),
  seedEntry({
    language: "typescript",
    problemType: "security",
    patternTags: ["api", "validation", "request"],
    question: "API route handler accepts external input without explicit validation boundaries.",
    answer: "Validate request body/query at entry points. Example:\nconst parsed = schema.safeParse(req.body);\nif (!parsed.success) return res.status(400).json({ error: 'invalid_input' });",
    actionItems: ["Add schema validation", "Reject unknown fields", "Test malformed payloads"],
  }),
  seedEntry({
    language: "typescript",
    problemType: "security",
    patternTags: ["sql", "injection", "query"],
    question: "SQL text is assembled with string concatenation and untrusted input.",
    answer: "Use parameterized SQL only. Example:\nawait db.execute('SELECT * FROM users WHERE email = ?', [email]);",
    actionItems: ["Remove SQL string concatenation", "Use bound parameters", "Add injection payload tests"],
  }),
  seedEntry({
    language: "python",
    problemType: "bug_risk",
    patternTags: ["exceptions", "bare-except"],
    question: "A bare except clause catches all exceptions and hides failure classes.",
    answer: "Catch explicit exception types and preserve unknown failures. Example:\ntry:\n    run_job()\nexcept ValueError as err:\n    handle_value_error(err)",
    actionItems: ["Replace bare except", "Catch specific exception classes", "Log and re-raise unexpected failures"],
  }),
  seedEntry({
    language: "python",
    problemType: "bug_risk",
    patternTags: ["defaults", "mutability"],
    question: "Function signature uses mutable default argument and leaks state across calls.",
    answer: "Use None defaults and allocate inside the function. Example:\ndef add_item(item, bucket=None):\n    bucket = [] if bucket is None else bucket\n    bucket.append(item)\n    return bucket",
    actionItems: ["Replace mutable defaults", "Add repeated-call regression tests", "Audit function signatures"],
  }),
  seedEntry({
    language: "python",
    problemType: "bug_risk",
    patternTags: ["files", "resource-leak"],
    question: "File handles are opened without deterministic close behavior.",
    answer: "Use context managers for guaranteed cleanup. Example:\nwith open(path, 'r', encoding='utf-8') as fh:\n    data = fh.read()",
    actionItems: ["Use with statements", "Remove manual close paths", "Add leak checks"],
  }),
  seedEntry({
    language: "python",
    problemType: "performance",
    patternTags: ["strings", "loops", "join"],
    question: "String concatenation inside loops causes repeated allocations.",
    answer: "Append parts and join once. Example:\nparts = []\nfor row in rows:\n    parts.append(str(row))\nresult = ''.join(parts)",
    actionItems: ["Replace += loop concatenation", "Use list accumulation", "Benchmark hotspots"],
  }),
  seedEntry({
    language: "python",
    problemType: "security",
    patternTags: ["shell", "command-exec"],
    question: "Shell execution uses os.system where safer subprocess APIs are available.",
    answer: "Prefer subprocess with argument lists. Example:\nimport subprocess\nsubprocess.run(['ls', '-la'], check=True)",
    actionItems: ["Replace os.system", "Avoid shell=True for untrusted input", "Validate command arguments"],
  }),
  seedEntry({
    language: "general",
    problemType: "maintainability",
    patternTags: ["complexity", "long-function"],
    question: "A function exceeds 50 lines and mixes multiple responsibilities.",
    answer: "Extract smaller units with explicit contracts. Example:\nvalidateInput();\ntransformPayload();\npersistResult();",
    actionItems: ["Split large functions", "Name intermediate steps", "Add tests per extracted unit"],
  }),
  seedEntry({
    language: "general",
    problemType: "maintainability",
    patternTags: ["control-flow", "nesting"],
    question: "Control flow exceeds three nested conditional levels and obscures intent.",
    answer: "Flatten with guard clauses and early returns. Example:\nif (!isValid(input)) return badRequest();\nif (!hasAccess(user)) return forbidden();\nreturn process(input);",
    actionItems: ["Introduce guard clauses", "Extract nested branches", "Reduce branch depth"],
  }),
  seedEntry({
    language: "general",
    problemType: "maintainability",
    patternTags: ["constants", "magic-number"],
    question: "Magic numbers appear inline without named semantic constants.",
    answer: "Extract literals into named constants. Example:\nconst MAX_RETRIES = 3;\nif (attempts > MAX_RETRIES) throw new Error('too_many_retries');",
    actionItems: ["Replace magic numbers", "Use intention-revealing constant names", "Centralize shared constants"],
  }),
  seedEntry({
    language: "general",
    problemType: "maintainability",
    patternTags: ["duplication", "copy-paste"],
    question: "Similar code blocks are duplicated across multiple modules.",
    answer: "Extract repeated logic into a shared helper/module. Example:\nfunction normalizeInput(raw) { /* shared logic */ }\n// call normalizeInput in all duplicated paths",
    actionItems: ["Extract shared helper", "Delete duplicated branches", "Add shared behavior regression tests"],
  }),
  seedEntry({
    language: "general",
    problemType: "maintainability",
    patternTags: ["todo", "fixme", "debt"],
    question: "TODO/FIXME comments remain in production code paths with unresolved behavior risk.",
    answer: "Track TODO/FIXME items with issue IDs and resolve or guard unfinished logic. Example:\n// TODO(ISSUE-123): replace temporary parser before release",
    actionItems: ["Link TODO/FIXME to tracked issues", "Resolve or gate incomplete paths", "Fail CI on untracked FIXME markers"],
  }),
  seedEntry({
    language: "general",
    problemType: "performance",
    patternTags: ["algorithm", "nested-loop", "complexity"],
    question: "Nested loops over large collections suggest O(n^2) hotspots in request-time logic.",
    answer: "Pre-index one side with a map/set to reduce repeated scans. Example:\nconst byId = new Map(items.map((x) => [x.id, x]));\nfor (const need of needs) {\n  const found = byId.get(need.id);\n  if (found) process(found);\n}",
    actionItems: ["Replace nested scans with indexed lookups", "Profile before/after", "Add performance regression test"],
  }),
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
  if (Array.isArray(parsed)) return parsed as SeedEntry[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)) {
    return (parsed as { entries: SeedEntry[] }).entries;
  }
  return [];
}

async function main(): Promise<void> {
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
      entries = normalizeEntries(JSON.parse(raw));
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
          String(entry.language ?? "general"),
          entry.framework ? String(entry.framework) : null,
          entry.patternTags ? (typeof entry.patternTags === "string" ? entry.patternTags : JSON.stringify(entry.patternTags)) : null,
          entry.fileType ? String(entry.fileType) : "source",
          String(entry.question),
          entry.contextHash ? String(entry.contextHash) : null,
          entry.codeSnippet ? String(entry.codeSnippet) : null,
          String(entry.answer),
          entry.actionItems ? (typeof entry.actionItems === "string" ? entry.actionItems : JSON.stringify(entry.actionItems)) : null,
          entry.confidence,
          entry.provider,
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
