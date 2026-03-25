import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type MigrationProbeResult = {
  repos: string[];
  knowledge: string[];
  knowledge_indexes: string[];
  knowledge_fts: boolean;
  agents: string[];
  city_events: string[];
  metric_snapshots: string[];
  execution_results: boolean;
  findings: boolean;
  reinforcement_events: boolean;
};

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function runMigrationProbe(dbPath: string): MigrationProbeResult {
  const dbModuleUrl = pathToFileURL(join(process.cwd(), "../../lib/db/src/index.ts")).href;
  const libsqlClientUrl = pathToFileURL(
    join(process.cwd(), "../../lib/db/node_modules/@libsql/client/lib-esm/node.js")
  ).href;

  const script = `
import { createClient } from "${libsqlClientUrl}";
import { ensureRuntimeDbMigrations } from "${dbModuleUrl}";

const dbPath = process.env.DB_PATH;
if (!dbPath) throw new Error("DB_PATH missing");

const bootstrap = createClient({ url: \`file:\${dbPath}\` });
await bootstrap.execute("CREATE TABLE IF NOT EXISTS repos (id TEXT PRIMARY KEY)");
await bootstrap.execute("CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY, problem_type TEXT NOT NULL DEFAULT 'unknown', language TEXT NOT NULL DEFAULT 'general', question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL DEFAULT 'medium', provider TEXT NOT NULL DEFAULT 'test', quality_score REAL NOT NULL DEFAULT 0.5, context_hash TEXT, pattern_tags TEXT)");
await bootstrap.execute("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY)");
await bootstrap.execute("CREATE TABLE IF NOT EXISTS city_events (id TEXT PRIMARY KEY, type TEXT, timestamp TEXT)");
await bootstrap.execute("CREATE TABLE IF NOT EXISTS metric_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL DEFAULT (datetime('now')), health_score REAL NOT NULL DEFAULT 0, coverage_overall REAL NOT NULL DEFAULT 0, active_agents INTEGER NOT NULL DEFAULT 0, paused_agents INTEGER NOT NULL DEFAULT 0, total_bugs INTEGER NOT NULL DEFAULT 0, kb_hit_rate REAL NOT NULL DEFAULT 0, tasks_completed INTEGER NOT NULL DEFAULT 0, escalations_today INTEGER NOT NULL DEFAULT 0, cpu_usage REAL NOT NULL DEFAULT 0, memory_mb REAL NOT NULL DEFAULT 0)");

await ensureRuntimeDbMigrations();
await ensureRuntimeDbMigrations();

const probe = createClient({ url: \`file:\${dbPath}\` });

const getColumns = async (tableName) => {
  const rows = await probe.execute(\`PRAGMA table_info(\${tableName})\`);
  return rows.rows.map((row) => String(row.name));
};

const getIndexes = async (tableName) => {
  const rows = await probe.execute(\`PRAGMA index_list(\${tableName})\`);
  return rows.rows.map((row) => String(row.name));
};

const tableExists = async (tableName) => {
  const rows = await probe.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return rows.rows.length > 0;
};

const result = {
  repos: await getColumns("repos"),
  knowledge: await getColumns("knowledge"),
  knowledge_indexes: await getIndexes("knowledge"),
  knowledge_fts: await tableExists("knowledge_fts"),
  agents: await getColumns("agents"),
  city_events: await getColumns("city_events"),
  metric_snapshots: await getColumns("metric_snapshots"),
  execution_results: await tableExists("execution_results"),
  findings: await tableExists("findings"),
  reinforcement_events: await tableExists("reinforcement_events"),
};

console.log(JSON.stringify(result));
`;

  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: dbPath,
    },
    encoding: "utf8",
  });

  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";

  expect(run.status, `Migration probe failed\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);

  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);

  expect(line, `Expected JSON output from probe\nstdout:\n${stdout}`).toBeTruthy();

  return JSON.parse(line ?? "{}") as MigrationProbeResult;
}

describe("ensureRuntimeDbMigrations", () => {
  it("is idempotent and applies expected runtime columns/tables", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codecity-migrations-"));
    tempDirs.push(tempDir);

    const dbPath = join(tempDir, "city.db");
    const result = runMigrationProbe(dbPath);

    expect(result.repos).toContain("github_token_hint");
    expect(result.repos).toContain("project_fingerprint");

    expect(result.knowledge).toContain("domain");
    expect(result.knowledge).toContain("embedding");
    expect(result.knowledge_indexes).toContain("idx_knowledge_language");
    expect(result.knowledge_indexes).toContain("idx_knowledge_problem_type");
    expect(result.knowledge_indexes).toContain("idx_knowledge_quality_score");
    expect(result.knowledge_indexes).toContain("idx_knowledge_context_hash");
    expect(typeof result.knowledge_fts).toBe("boolean");

    expect(result.agents).toContain("visited_files");
    expect(result.agents).toContain("personal_kb");
    expect(result.agents).toContain("observations");
    expect(result.agents).toContain("specialty_score");
    expect(result.agents).toContain("last_file_hash");

    expect(result.city_events).toContain("file_path");
    expect(result.city_events).toContain("issue_type");
    expect(result.city_events).toContain("confidence");
    expect(result.city_events).toContain("code_reference");
    expect(result.city_events).toContain("confirmations");
    expect(result.city_events).toContain("finding_severity");
    expect(result.city_events).toContain("finding_text");

    expect(result.metric_snapshots).toContain("prediction_accuracy_score");
    expect(result.metric_snapshots).toContain("false_negative_rate");
    expect(result.metric_snapshots).toContain("confidence_calibration_index");
    expect(result.metric_snapshots).toContain("recommendation_fix_conversion");
    expect(result.metric_snapshots).toContain("test_generation_effectiveness");
    expect(result.metric_snapshots).toContain("kpi_sample_size");
    expect(result.metric_snapshots).toContain("reinforcement_attempts");
    expect(result.metric_snapshots).toContain("reinforcement_applied");
    expect(result.metric_snapshots).toContain("reinforcement_boosts");
    expect(result.metric_snapshots).toContain("reinforcement_decays");
    expect(result.metric_snapshots).toContain("reinforcement_net");
    expect(result.metric_snapshots).toContain("reinforcement_coverage");
    expect(result.metric_snapshots).toContain("aging_personal_updates");
    expect(result.metric_snapshots).toContain("aging_knowledge_updates");

    expect(result.execution_results).toBe(true);
    expect(result.findings).toBe(true);
    expect(result.reinforcement_events).toBe(true);
  }, 15000);
});
