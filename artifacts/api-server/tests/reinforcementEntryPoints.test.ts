import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type ReinforcementEntryProbeResult = {
  verdictStatus: number;
  duplicateVerdictStatus: number;
  recommendationStatus: number;
  recommendationPartialStatus: number;
  verdictPhase2Applied: boolean;
  recommendationPhase2Action: string | null;
  reinforcementBoostCount: number;
  reinforcementDecayCount: number;
  reinforcementAppliedCount: number;
  reinforcementNotAppliedCount: number;
  phase2CityEvents: number;
};

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function runProbe(dbPath: string): ReinforcementEntryProbeResult {
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
  CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    building_id TEXT,
    building_name TEXT,
    file_path TEXT NOT NULL,
    file_type TEXT,
    language TEXT NOT NULL,
    function_name TEXT,
    line_reference TEXT,
    finding TEXT,
    severity TEXT NOT NULL DEFAULT 'LOW',
    base_confidence REAL NOT NULL DEFAULT 0,
    final_confidence REAL NOT NULL DEFAULT 0,
    classification TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL,
    consulted_by TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);

await client.execute(\`
  CREATE TABLE IF NOT EXISTS city_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    building_id TEXT,
    building_name TEXT,
    agent_id TEXT,
    agent_name TEXT,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    file_path TEXT,
    issue_type TEXT,
    confidence REAL,
    code_reference TEXT,
    confirmations INTEGER NOT NULL DEFAULT 1,
    finding_severity TEXT,
    finding_text TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  )
\`);

await client.execute(\`
  CREATE TABLE IF NOT EXISTS reinforcement_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    verdict TEXT NOT NULL,
    verdict_origin TEXT,
    issue_pattern TEXT NOT NULL,
    file_path TEXT,
    agent_id TEXT,
    agent_name TEXT,
    agent_role TEXT,
    finding_id TEXT,
    linked_context TEXT,
    personal_kb_action TEXT NOT NULL DEFAULT 'none',
    personal_kb_changed INTEGER NOT NULL DEFAULT 0,
    shared_knowledge_updated INTEGER NOT NULL DEFAULT 0,
    shared_knowledge_seeded INTEGER NOT NULL DEFAULT 0,
    quality_delta REAL NOT NULL DEFAULT 0,
    confidence_delta REAL NOT NULL DEFAULT 0,
    attempted INTEGER NOT NULL DEFAULT 1,
    applied INTEGER NOT NULL DEFAULT 0,
    cooldown_skipped INTEGER NOT NULL DEFAULT 0,
    evidence_score REAL NOT NULL DEFAULT 0
  )
\`);

await client.execute(\`
  CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_url TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    slug TEXT,
    github_token_hint TEXT,
    project_fingerprint TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 0,
    district_count INTEGER NOT NULL DEFAULT 0,
    health_score REAL NOT NULL DEFAULT 50,
    season TEXT NOT NULL DEFAULT 'spring',
    layout_data TEXT,
    analysis_time REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  ["agent-r1", "Reinforce QA", "qa_inspector", "#32d583", 0.5, 5, 5]
);

await client.execute(
  \`INSERT INTO findings (
      agent_id, agent_name, agent_role, file_path, file_type, language, function_name, line_reference, finding,
      severity, base_confidence, final_confidence, classification, status, source, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
  [
    "agent-r1",
    "Reinforce QA",
    "qa_inspector",
    "src/routes/orders.ts",
    "ts",
    "typescript",
    "createOrder",
    "L42",
    "Missing guard for null order payload before property access",
    "HIGH",
    0.72,
    0.82,
    "bug",
    "pending",
    "test",
    "{}"
  ]
);

await client.execute(
  \`INSERT INTO repos (repo_url, repo_name, branch, slug, is_active, health_score, season, layout_data)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)\`,
  ["https://example.com/reinforcement.git", "Reinforcement Repo", "main", "reinforcement-repo", 1, 67, "spring", "{\\\"districts\\\":[]}"]
);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to bind test server");
}

const baseUrl = \`http://127.0.0.1:\${address.port}\`;

const verdictResponse = await fetch(\`\${baseUrl}/api/agents/agent-r1/verdict\`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ verdict: "true_positive" }),
});
const verdictPayload = await verdictResponse.json();

const duplicateVerdictResponse = await fetch(\`\${baseUrl}/api/agents/agent-r1/verdict\`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ verdict: "false_positive" }),
});

const recommendationResponse = await fetch(\`\${baseUrl}/api/orchestrator/recommendation-feedback\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    verdict: "rejected",
    sourceFilePath: "src/routes/orders.ts",
    testFilePath: "tests/orders.test.ts",
    findingText: "Order payload validation false alarm after guard was added",
    issueType: "validation-noise",
    confidence: 0.76,
  }),
});
const recommendationPayload = await recommendationResponse.json();

const recommendationPartialResponse = await fetch(\`\${baseUrl}/api/orchestrator/recommendation-feedback\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    verdict: "approved",
    sourceFilePath: "src/routes/billing.ts",
    testFilePath: "tests/billing.test.ts",
  }),
});

const reinforcementRows = await client.execute(
  \`SELECT event_type, applied, COUNT(*) as total FROM reinforcement_events GROUP BY event_type, applied\`
);
const phase2EventRows = await client.execute(
  \`SELECT COUNT(*) as total FROM city_events WHERE type LIKE 'phase2_reinforcement_%'\`
);

let reinforcementBoostCount = 0;
let reinforcementDecayCount = 0;
let reinforcementAppliedCount = 0;
let reinforcementNotAppliedCount = 0;

for (const row of reinforcementRows.rows) {
  const eventType = String(row.event_type ?? "");
  const applied = Number(row.applied ?? 0);
  const total = Number(row.total ?? 0);

  if (eventType === "phase2_reinforcement_boost") reinforcementBoostCount += total;
  if (eventType === "phase2_reinforcement_decay") reinforcementDecayCount += total;
  if (applied === 1) reinforcementAppliedCount += total;
  if (applied === 0) reinforcementNotAppliedCount += total;
}

await new Promise((resolve) => server.close(() => resolve()));

console.log(JSON.stringify({
  verdictStatus: verdictResponse.status,
  duplicateVerdictStatus: duplicateVerdictResponse.status,
  recommendationStatus: recommendationResponse.status,
  recommendationPartialStatus: recommendationPartialResponse.status,
  verdictPhase2Applied: Boolean(verdictPayload?.phase2Applied ?? false),
  recommendationPhase2Action: typeof recommendationPayload?.phase2PersonalKbAction === "string" ? recommendationPayload.phase2PersonalKbAction : null,
  reinforcementBoostCount,
  reinforcementDecayCount,
  reinforcementAppliedCount,
  reinforcementNotAppliedCount,
  phase2CityEvents: Number(phase2EventRows.rows[0]?.total ?? 0),
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

  expect(run.status, `Reinforcement entrypoint probe failed\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);

  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);

  expect(line, `Expected JSON output from probe\nstdout:\n${stdout}`).toBeTruthy();

  return JSON.parse(line ?? "{}") as ReinforcementEntryProbeResult;
}

describe("Phase 2 reinforcement entry points", () => {
  it("records reinforcement telemetry for direct verdict and recommendation feedback with duplicate protection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codecity-reinforcement-"));
    tempDirs.push(tempDir);

    const dbPath = join(tempDir, "city.db");
    const result = runProbe(dbPath);

    expect(result.verdictStatus).toBe(200);
    expect(result.duplicateVerdictStatus).toBe(409);
    expect(result.recommendationStatus).toBe(200);
    expect(result.recommendationPartialStatus).toBe(200);

    expect(typeof result.verdictPhase2Applied).toBe("boolean");
    expect(result.recommendationPhase2Action === null || typeof result.recommendationPhase2Action === "string").toBe(true);

    expect(result.reinforcementBoostCount).toBeGreaterThanOrEqual(1);
    expect(result.reinforcementDecayCount).toBeGreaterThanOrEqual(1);
    expect(result.reinforcementAppliedCount).toBeGreaterThanOrEqual(1);
    expect(result.reinforcementNotAppliedCount).toBeGreaterThanOrEqual(1);
    expect(result.phase2CityEvents).toBeGreaterThanOrEqual(2);
  }, 20000);
});
