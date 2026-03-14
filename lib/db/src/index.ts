import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(process.cwd(), "data/city.db");

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const client = createClient({ url: `file:${dbPath}` });

export const db = drizzle(client, { schema });

function isDuplicateColumnError(error: unknown, columnName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("duplicate column") && lower.includes(columnName.toLowerCase());
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("no such table") && lower.includes(tableName.toLowerCase());
}

async function addColumnIfMissing(
  sqlStatement: string,
  columnName: string,
  options?: { allowMissingTable?: string },
): Promise<void> {
  try {
    await client.execute(sqlStatement);
  } catch (error) {
    if (isDuplicateColumnError(error, columnName)) return;
    if (options?.allowMissingTable && isMissingTableError(error, options.allowMissingTable)) return;
    throw error;
  }
}

export async function ensureRuntimeDbMigrations(): Promise<void> {
  await addColumnIfMissing("ALTER TABLE repos ADD COLUMN github_token_hint TEXT", "github_token_hint");
  await addColumnIfMissing("ALTER TABLE repos ADD COLUMN project_fingerprint TEXT", "project_fingerprint");

  await addColumnIfMissing("ALTER TABLE knowledge ADD COLUMN domain TEXT", "domain");
  await addColumnIfMissing("ALTER TABLE knowledge ADD COLUMN embedding TEXT", "embedding");

  // Some older DB snapshots use the previous table name.
  await addColumnIfMissing("ALTER TABLE knowledge_entries ADD COLUMN domain TEXT", "domain", { allowMissingTable: "knowledge_entries" });
  await addColumnIfMissing("ALTER TABLE knowledge_entries ADD COLUMN embedding TEXT", "embedding", { allowMissingTable: "knowledge_entries" });

  await addColumnIfMissing("ALTER TABLE agents ADD COLUMN visited_files TEXT DEFAULT '[]' NOT NULL", "visited_files");
  await addColumnIfMissing("ALTER TABLE agents ADD COLUMN personal_kb TEXT DEFAULT '[]' NOT NULL", "personal_kb");
  await addColumnIfMissing("ALTER TABLE agents ADD COLUMN observations TEXT DEFAULT '[]' NOT NULL", "observations");
  await addColumnIfMissing("ALTER TABLE agents ADD COLUMN specialty_score REAL DEFAULT 0 NOT NULL", "specialty_score");
  await addColumnIfMissing("ALTER TABLE agents ADD COLUMN last_file_hash TEXT", "last_file_hash");

  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN file_path TEXT", "file_path");
  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN issue_type TEXT", "issue_type");
  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN confidence REAL", "confidence");
  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN code_reference TEXT", "code_reference");
  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN confirmations INTEGER DEFAULT 1 NOT NULL", "confirmations");
  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN finding_severity TEXT", "finding_severity");
  await addColumnIfMissing("ALTER TABLE city_events ADD COLUMN finding_text TEXT", "finding_text");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS execution_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      triggered_by TEXT NOT NULL DEFAULT 'alchemist',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute("CREATE INDEX IF NOT EXISTS idx_execution_results_started_at ON execution_results(started_at)");

  await client.execute(`
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
  `);

  await addColumnIfMissing("ALTER TABLE findings ADD COLUMN consulted_by TEXT", "consulted_by", { allowMissingTable: "findings" });
  await client.execute("CREATE INDEX IF NOT EXISTS idx_findings_agent_id ON findings(agent_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_findings_file_path ON findings(file_path)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_findings_classification ON findings(classification)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_city_events_finding_dedupe ON city_events(type, file_path, issue_type, timestamp)");
}

export * from "./schema";
