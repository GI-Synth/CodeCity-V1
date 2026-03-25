import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type ImportReviewProbeResult = {
  status: number;
  verdictsProcessed: number;
  kbEntriesAdded: number;
  agentsUpdated: string[];
  accuracyChanges: Array<{ agentName: string; before: number; after: number }>;
  persistedSettingKeys: string[];
  persistedProblemTypes: string[];
  updatedAccuracy: number | null;
  phase2ReinforcementCount: number;
};

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function runImportReviewProbe(dbPath: string): ImportReviewProbeResult {
  const appModuleUrl = pathToFileURL(join(process.cwd(), "src/app.ts")).href;
  const libsqlClientUrl = pathToFileURL(
    join(process.cwd(), "../../lib/db/node_modules/@libsql/client/lib-esm/node.js")
  ).href;

  const script = `
import http from "node:http";
import app from "${appModuleUrl}";
import { createClient } from "${libsqlClientUrl}";

const dbPath = process.env.DB_PATH;
if (!dbPath) throw new Error("DB_PATH missing");

const client = createClient({ url: \`file:\${dbPath}\` });

await client.execute(\`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    current_building TEXT,
    current_task TEXT,
    bugs_found INTEGER NOT NULL DEFAULT 0,
    tests_generated INTEGER NOT NULL DEFAULT 0,
    escalations INTEGER NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 0.8,
    level INTEGER NOT NULL DEFAULT 1,
    dialogue TEXT NOT NULL DEFAULT 'Ready to inspect code...',
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    color TEXT NOT NULL,
    true_positives INTEGER NOT NULL DEFAULT 0,
    false_positives INTEGER NOT NULL DEFAULT 0,
    escalation_count INTEGER NOT NULL DEFAULT 0,
    kb_hits INTEGER NOT NULL DEFAULT 0,
    visited_files TEXT NOT NULL DEFAULT '[]',
    personal_kb TEXT NOT NULL DEFAULT '[]',
    observations TEXT NOT NULL DEFAULT '[]',
    specialty_score REAL NOT NULL DEFAULT 0,
    last_file_hash TEXT,
    rank TEXT NOT NULL DEFAULT 'junior',
    total_tasks_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);

await client.execute(\`
  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT,
    use_count INTEGER NOT NULL DEFAULT 1,
    problem_type TEXT NOT NULL,
    language TEXT NOT NULL,
    framework TEXT,
    pattern_tags TEXT,
    file_type TEXT,
    question TEXT NOT NULL,
    context_hash TEXT,
    code_snippet TEXT,
    answer TEXT NOT NULL,
    action_items TEXT,
    confidence TEXT NOT NULL,
    provider TEXT NOT NULL,
    domain TEXT,
    embedding TEXT,
    was_useful INTEGER NOT NULL DEFAULT 1,
    produced_bugs INTEGER NOT NULL DEFAULT 0,
    quality_score REAL NOT NULL DEFAULT 0.5
  )
\`);

await client.execute(\`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);

await client.execute(
  \`INSERT INTO agents (id, name, role, color, accuracy, true_positives, false_positives)
   VALUES (?, ?, ?, ?, ?, ?, ?)\`,
  ["agent-test-1", "Test QA", "qa_inspector", "#4a9eff", 0.5, 5, 5]
);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to bind test server");
}

const baseUrl = \`http://127.0.0.1:\${address.port}\`;
const reviewText = [
  "VERDICTS",
  "- FINDING #1 REAL BUG",
  "",
  "AGENT LEARNING",
  "- Mayor: increase qa confidence",
  "- Mayor: should NEVER report style issues without evidence",
  "",
  "IMPLEMENTED FIXES",
  "- Added explicit input validation around API boundary.",
].join("\\n");

const response = await fetch(\`\${baseUrl}/api/orchestrator/import-review\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reviewText }),
});

const payload = await response.json();

const settingsRows = await client.execute(
  "SELECT key FROM settings WHERE key IN ('mayor_recent_reviews', 'mayor_last_review_date', 'mayor_last_review_summary') ORDER BY key"
);
const knowledgeRows = await client.execute(
  "SELECT problem_type FROM knowledge ORDER BY id"
);
const updatedAgentRows = await client.execute(
  "SELECT accuracy FROM agents WHERE id = ? LIMIT 1",
  ["agent-test-1"]
);

await new Promise((resolve) => server.close(() => resolve()));

console.log(JSON.stringify({
  status: response.status,
  verdictsProcessed: Number(payload?.verdictsProcessed ?? 0),
  kbEntriesAdded: Number(payload?.kbEntriesAdded ?? 0),
  agentsUpdated: Array.isArray(payload?.agentsUpdated) ? payload.agentsUpdated : [],
  accuracyChanges: Array.isArray(payload?.accuracyChanges) ? payload.accuracyChanges : [],
  persistedSettingKeys: settingsRows.rows.map((row) => String(row.key)),
  persistedProblemTypes: knowledgeRows.rows.map((row) => String(row.problem_type)),
  updatedAccuracy: updatedAgentRows.rows.length > 0 ? Number(updatedAgentRows.rows[0].accuracy) : null,
  phase2ReinforcementCount: Number(payload?.phase2ReinforcementCount ?? 0),
}));
`;

  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      NODE_ENV: "test",
    },
    encoding: "utf8",
  });

  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";

  expect(run.status, `Import review probe failed\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);

  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);

  expect(line, `Expected JSON output from import review probe\nstdout:\n${stdout}`).toBeTruthy();

  return JSON.parse(line ?? "{}") as ImportReviewProbeResult;
}

describe("POST /api/orchestrator/import-review", () => {
  it("persists learning updates and adjusts matching agent confidence in isolated DB", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codecity-import-review-"));
    tempDirs.push(tempDir);

    const dbPath = join(tempDir, "city.db");
    const result = runImportReviewProbe(dbPath);

    expect(result.status).toBe(200);
    expect(result.verdictsProcessed).toBeGreaterThan(0);
    expect(result.kbEntriesAdded).toBeGreaterThanOrEqual(1);
    expect(result.agentsUpdated).toContain("Test QA");
    expect(result.persistedProblemTypes).toContain("review_import_avoid_pattern");
    expect(result.persistedSettingKeys).toEqual([
      "mayor_last_review_date",
      "mayor_last_review_summary",
      "mayor_recent_reviews",
    ]);

    const qaChange = result.accuracyChanges.find((change) => change.agentName === "Test QA");
    expect(qaChange).toBeTruthy();
    expect((qaChange?.after ?? 0)).toBeGreaterThan(qaChange?.before ?? 0);
    expect(result.updatedAccuracy).toBeGreaterThan(0.5);
  }, 15000);
});
