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

function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("already exists");
}

function isOptionalFtsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes("no such module: fts5")
    || lower.includes("fts5 is disabled")
    || lower.includes("no such table: knowledge_fts")
    || lower.includes("no such table: main.knowledge_fts")
    || isAlreadyExistsError(error)
  );
}

function isFtsCorruptionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("sqlite_corrupt") || lower.includes("database disk image is malformed");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendErrorText(current: string | null, next: string): string {
  if (!current) return next;
  return `${current} | ${next}`;
}

function toRowsAffected(result: unknown): number {
  const value = (result as { rowsAffected?: unknown })?.rowsAffected;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function stringifyRowSnapshot(row: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "bigint") {
      normalized[key] = value.toString();
    } else if (value instanceof Uint8Array) {
      normalized[key] = Array.from(value);
    } else {
      normalized[key] = value;
    }
  }

  return JSON.stringify(normalized);
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

async function executeOptionalFts(sqlStatement: string): Promise<void> {
  try {
    await client.execute(sqlStatement);
  } catch (error) {
    if (isOptionalFtsError(error)) return;
    throw error;
  }
}

async function getTableColumns(tableName: string): Promise<Set<string>> {
  try {
    const rows = await client.execute(`PRAGMA table_info(${tableName})`);
    return new Set(rows.rows.map((row) => String(row.name)));
  } catch {
    return new Set();
  }
}

async function createIndexIfColumnExists(indexName: string, tableName: string, columnName: string): Promise<void> {
  const columns = await getTableColumns(tableName);
  if (!columns.has(columnName)) return;
  await client.execute(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnName})`);
}

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await client.execute({
    sql: "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [tableName],
  });

  return rows.rows.length > 0;
}

async function createKnowledgeFtsArtifacts(): Promise<void> {
  await executeOptionalFts(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
    USING fts5(
      question,
      answer,
      problem_type,
      pattern_tags,
      language,
      domain,
      content='knowledge',
      content_rowid='id'
    )
  `);

  await executeOptionalFts(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_ai AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(rowid, question, answer, problem_type, pattern_tags, language, domain)
      VALUES (new.id, new.question, new.answer, new.problem_type, new.pattern_tags, new.language, new.domain);
    END;
  `);

  await executeOptionalFts(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_ad AFTER DELETE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, question, answer, problem_type, pattern_tags, language, domain)
      VALUES ('delete', old.id, old.question, old.answer, old.problem_type, old.pattern_tags, old.language, old.domain);
    END;
  `);

  await executeOptionalFts(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_au AFTER UPDATE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, question, answer, problem_type, pattern_tags, language, domain)
      VALUES ('delete', old.id, old.question, old.answer, old.problem_type, old.pattern_tags, old.language, old.domain);
      INSERT INTO knowledge_fts(rowid, question, answer, problem_type, pattern_tags, language, domain)
      VALUES (new.id, new.question, new.answer, new.problem_type, new.pattern_tags, new.language, new.domain);
    END;
  `);
}

async function dropKnowledgeFtsArtifacts(): Promise<void> {
  await executeOptionalFts("DROP TRIGGER IF EXISTS knowledge_fts_ai");
  await executeOptionalFts("DROP TRIGGER IF EXISTS knowledge_fts_ad");
  await executeOptionalFts("DROP TRIGGER IF EXISTS knowledge_fts_au");
  await executeOptionalFts("DROP TABLE IF EXISTS knowledge_fts");
}

async function ensureHealthyKnowledgeFtsArtifacts(): Promise<void> {
  await createKnowledgeFtsArtifacts();

  try {
    await client.execute("INSERT INTO knowledge_fts(knowledge_fts) VALUES ('integrity-check')");
  } catch (error) {
    if (!isFtsCorruptionError(error)) {
      if (isOptionalFtsError(error)) return;
      throw error;
    }

    await dropKnowledgeFtsArtifacts();

    try {
      await createKnowledgeFtsArtifacts();
      await client.execute("INSERT INTO knowledge_fts(knowledge_fts) VALUES ('rebuild')");
      await client.execute("INSERT INTO knowledge_fts(knowledge_fts) VALUES ('integrity-check')");
    } catch (repairError) {
      if (isFtsCorruptionError(repairError) || isOptionalFtsError(repairError)) {
        await dropKnowledgeFtsArtifacts();
        return;
      }

      throw repairError;
    }
  }
}

export type RepairCorruptKnowledgeRowParams = {
  rowId: number;
  source?: string | null;
  detail?: string | null;
};

export type RepairCorruptKnowledgeRowResult = {
  rowId: number;
  source: string | null;
  detail: string | null;
  quarantineTableEnsured: boolean;
  rowSnapshotAttempted: boolean;
  rowSnapshotCaptured: boolean;
  snapshotError: string | null;
  quarantineInserted: boolean;
  knowledgeDeleteAttempted: boolean;
  knowledgeDeleteCount: number;
  ftsCleanupAttempted: boolean;
  ftsCleanupCount: number;
  success: boolean;
  error: string | null;
};

export async function repairCorruptKnowledgeRow(
  params: RepairCorruptKnowledgeRowParams,
): Promise<RepairCorruptKnowledgeRowResult> {
  const normalizedRowId = Number(params.rowId);
  const rowId = Number.isInteger(normalizedRowId) && normalizedRowId > 0
    ? normalizedRowId
    : Number.NaN;
  const source = normalizeOptionalText(params.source);
  const detail = normalizeOptionalText(params.detail);

  const result: RepairCorruptKnowledgeRowResult = {
    rowId: Number.isFinite(rowId) ? rowId : 0,
    source,
    detail,
    quarantineTableEnsured: false,
    rowSnapshotAttempted: false,
    rowSnapshotCaptured: false,
    snapshotError: null,
    quarantineInserted: false,
    knowledgeDeleteAttempted: false,
    knowledgeDeleteCount: 0,
    ftsCleanupAttempted: false,
    ftsCleanupCount: 0,
    success: false,
    error: null,
  };

  if (!Number.isFinite(rowId)) {
    result.error = "Invalid knowledge row id";
    return result;
  }

  let snapshotJson: string | null = null;

  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_corruption_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledge_row_id INTEGER NOT NULL,
        source TEXT,
        detail TEXT,
        captured_at TEXT NOT NULL DEFAULT (datetime('now')),
        snapshot_json TEXT,
        snapshot_error TEXT,
        delete_attempted INTEGER NOT NULL DEFAULT 0,
        delete_count INTEGER NOT NULL DEFAULT 0,
        fts_cleanup_attempted INTEGER NOT NULL DEFAULT 0,
        fts_cleanup_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.execute(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_corruption_quarantine_row_id
      ON knowledge_corruption_quarantine(knowledge_row_id)
    `);
    result.quarantineTableEnsured = true;
  } catch (error) {
    result.error = appendErrorText(result.error, `quarantine table error: ${toErrorMessage(error)}`);
  }

  result.rowSnapshotAttempted = true;
  try {
    const rows = await client.execute({
      sql: "SELECT * FROM knowledge WHERE id = ? LIMIT 1",
      args: [rowId],
    });
    const snapshot = rows.rows[0] as Record<string, unknown> | undefined;
    if (snapshot) {
      snapshotJson = stringifyRowSnapshot(snapshot);
      result.rowSnapshotCaptured = true;
    }
  } catch (error) {
    const message = toErrorMessage(error);
    result.snapshotError = message;
    result.error = appendErrorText(result.error, `snapshot error: ${message}`);
  }

  result.knowledgeDeleteAttempted = true;
  try {
    const deleteResult = await client.execute({
      sql: "DELETE FROM knowledge WHERE id = ?",
      args: [rowId],
    });
    result.knowledgeDeleteCount = toRowsAffected(deleteResult);
  } catch (error) {
    result.error = appendErrorText(result.error, `knowledge delete error: ${toErrorMessage(error)}`);
  }

  try {
    const hasFtsTable = await tableExists("knowledge_fts");
    if (hasFtsTable) {
      result.ftsCleanupAttempted = true;
      try {
        const deleteFtsResult = await client.execute({
          sql: "DELETE FROM knowledge_fts WHERE rowid = ?",
          args: [rowId],
        });
        result.ftsCleanupCount = toRowsAffected(deleteFtsResult);
      } catch (error) {
        result.error = appendErrorText(result.error, `fts cleanup error: ${toErrorMessage(error)}`);
      }
    }
  } catch (error) {
    result.error = appendErrorText(result.error, `fts lookup error: ${toErrorMessage(error)}`);
  }

  if (result.quarantineTableEnsured) {
    try {
      await client.execute({
        sql: `
          INSERT INTO knowledge_corruption_quarantine (
            knowledge_row_id,
            source,
            detail,
            snapshot_json,
            snapshot_error,
            delete_attempted,
            delete_count,
            fts_cleanup_attempted,
            fts_cleanup_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          rowId,
          source,
          detail,
          snapshotJson,
          result.snapshotError,
          result.knowledgeDeleteAttempted ? 1 : 0,
          result.knowledgeDeleteCount,
          result.ftsCleanupAttempted ? 1 : 0,
          result.ftsCleanupCount,
        ],
      });
      result.quarantineInserted = true;
    } catch (error) {
      result.error = appendErrorText(result.error, `quarantine insert error: ${toErrorMessage(error)}`);
    }
  }

  result.success = result.knowledgeDeleteCount > 0;
  return result;
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

  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN prediction_accuracy_score REAL DEFAULT 0 NOT NULL",
    "prediction_accuracy_score",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN false_negative_rate REAL DEFAULT 0 NOT NULL",
    "false_negative_rate",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN confidence_calibration_index REAL DEFAULT 0 NOT NULL",
    "confidence_calibration_index",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN recommendation_fix_conversion REAL DEFAULT 0 NOT NULL",
    "recommendation_fix_conversion",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN test_generation_effectiveness REAL DEFAULT 0 NOT NULL",
    "test_generation_effectiveness",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN kpi_sample_size INTEGER DEFAULT 0 NOT NULL",
    "kpi_sample_size",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN reinforcement_attempts INTEGER DEFAULT 0 NOT NULL",
    "reinforcement_attempts",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN reinforcement_applied INTEGER DEFAULT 0 NOT NULL",
    "reinforcement_applied",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN reinforcement_boosts INTEGER DEFAULT 0 NOT NULL",
    "reinforcement_boosts",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN reinforcement_decays INTEGER DEFAULT 0 NOT NULL",
    "reinforcement_decays",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN reinforcement_net INTEGER DEFAULT 0 NOT NULL",
    "reinforcement_net",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN reinforcement_coverage REAL DEFAULT 0 NOT NULL",
    "reinforcement_coverage",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN aging_personal_updates INTEGER DEFAULT 0 NOT NULL",
    "aging_personal_updates",
    { allowMissingTable: "metric_snapshots" },
  );
  await addColumnIfMissing(
    "ALTER TABLE metric_snapshots ADD COLUMN aging_knowledge_updates INTEGER DEFAULT 0 NOT NULL",
    "aging_knowledge_updates",
    { allowMissingTable: "metric_snapshots" },
  );

  await createIndexIfColumnExists("idx_knowledge_language", "knowledge", "language");
  await createIndexIfColumnExists("idx_knowledge_problem_type", "knowledge", "problem_type");
  await createIndexIfColumnExists("idx_knowledge_quality_score", "knowledge", "quality_score");
  await createIndexIfColumnExists("idx_knowledge_context_hash", "knowledge", "context_hash");

  const knowledgeColumns = await getTableColumns("knowledge");
  const hasFtsColumns = ["id", "question", "answer", "problem_type", "pattern_tags", "language", "domain"]
    .every((column) => knowledgeColumns.has(column));

  if (hasFtsColumns) {
    await ensureHealthyKnowledgeFtsArtifacts();
  }

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

  await client.execute(`
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
  `);

  await client.execute("CREATE INDEX IF NOT EXISTS idx_reinforcement_events_timestamp ON reinforcement_events(timestamp)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_reinforcement_events_issue_pattern ON reinforcement_events(issue_pattern)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_reinforcement_events_agent_id ON reinforcement_events(agent_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_reinforcement_events_source ON reinforcement_events(source)");

  // --- CodeCity Intelligence tables ---

  await client.execute(`
    CREATE TABLE IF NOT EXISTS code_graph_nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      complexity_score INTEGER NOT NULL DEFAULT 0,
      cognitive_complexity INTEGER NOT NULL DEFAULT 0,
      loc INTEGER NOT NULL DEFAULT 0,
      test_coverage_pct REAL,
      is_dead_code INTEGER NOT NULL DEFAULT 0,
      has_circular_dep INTEGER NOT NULL DEFAULT 0,
      import_count INTEGER NOT NULL DEFAULT 0,
      export_count INTEGER NOT NULL DEFAULT 0,
      last_analyzed_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_code_graph_nodes_file_path ON code_graph_nodes(file_path)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_code_graph_nodes_complexity ON code_graph_nodes(complexity_score)");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS code_graph_edges (
      id TEXT PRIMARY KEY,
      from_node TEXT NOT NULL,
      to_node TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      is_circular INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_code_graph_edges_from ON code_graph_edges(from_node)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_code_graph_edges_to ON code_graph_edges(to_node)");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      finding_id TEXT,
      vote TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_messages_timestamp ON agent_messages(timestamp)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(from_agent)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_agent_messages_finding ON agent_messages(finding_id)");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS log_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL,
      raw TEXT NOT NULL,
      message TEXT NOT NULL,
      stack_trace TEXT,
      file TEXT,
      line INTEGER,
      error_type TEXT,
      perf_label TEXT,
      perf_duration INTEGER,
      source_node_id TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_timestamp ON log_entries(timestamp)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_level ON log_entries(level)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_file ON log_entries(file)");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS agent_accuracy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      total_findings INTEGER NOT NULL DEFAULT 0,
      true_positives INTEGER NOT NULL DEFAULT 0,
      false_positives INTEGER NOT NULL DEFAULT 0,
      accuracy_score REAL NOT NULL DEFAULT 0.8,
      last_updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_accuracy_role ON agent_accuracy(agent_role)");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS pattern_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      weight REAL NOT NULL DEFAULT 1.0,
      boost_count INTEGER NOT NULL DEFAULT 0,
      decay_count INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_pattern_weights_pattern ON pattern_weights(pattern_id)");

  await client.execute(`
    CREATE TABLE IF NOT EXISTS pattern_suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_id TEXT NOT NULL,
      file_path TEXT,
      suppressed_until TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_pattern_suppressions_pattern ON pattern_suppressions(pattern_id)");
}

export * from "./schema";
