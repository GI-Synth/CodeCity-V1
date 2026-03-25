#!/usr/bin/env tsx

import { createClient } from "@libsql/client";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyReinforcementEvent,
  type ReinforcementEventClassificationReason,
} from "../artifacts/api-server/src/lib/reinforcementDataHygiene";

type ReinforcementEventRow = {
  id: number;
  source: string;
  verdictOrigin: string | null;
  findingId: string | null;
};

type SourceBreakdown = {
  total: number;
  synthetic: number;
};

type ReasonBreakdown = {
  [K in ReinforcementEventClassificationReason]?: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_DB_PATH = resolve(REPO_ROOT, "artifacts/api-server/data/city.db");
const CHUNK_SIZE = 250;

function toRowsAffected(result: unknown): number {
  const value = (result as { rowsAffected?: unknown })?.rowsAffected;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function toOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function resolveDbPath(): string {
  const fromEnv = process.env.DB_PATH?.trim();
  if (!fromEnv) return DEFAULT_DB_PATH;
  return resolve(process.cwd(), fromEnv);
}

function parseFlags(argv: string[]): { apply: boolean; dryRun: boolean } {
  const hasApply = argv.includes("--apply");
  const hasDryRun = argv.includes("--dry-run");
  const dryRun = hasDryRun || !hasApply;
  return {
    apply: !dryRun,
    dryRun,
  };
}

function printSourceBreakdown(bySource: Map<string, SourceBreakdown>): void {
  if (bySource.size === 0) {
    console.log("By-source breakdown: none");
    return;
  }

  console.log("By-source breakdown:");
  const entries = Array.from(bySource.entries())
    .sort((a, b) => {
      const syntheticDelta = b[1].synthetic - a[1].synthetic;
      if (syntheticDelta !== 0) return syntheticDelta;
      return b[1].total - a[1].total;
    });

  for (const [source, stats] of entries) {
    const realCount = stats.total - stats.synthetic;
    console.log(`- ${source}: total=${stats.total}, synthetic=${stats.synthetic}, real=${realCount}`);
  }
}

function printReasonBreakdown(byReason: ReasonBreakdown): void {
  console.log("Synthetic reason breakdown:");
  const entries = Object.entries(byReason)
    .sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0));

  if (entries.length === 0) {
    console.log("- none");
    return;
  }

  for (const [reason, count] of entries) {
    console.log(`- ${reason}: ${count}`);
  }
}

async function ensureQuarantineTable(client: ReturnType<typeof createClient>): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reinforcement_events_quarantine (
      quarantine_id INTEGER PRIMARY KEY AUTOINCREMENT,
      quarantined_at TEXT NOT NULL DEFAULT (datetime('now')),
      quarantine_reason TEXT NOT NULL,
      original_event_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
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
      personal_kb_action TEXT NOT NULL,
      personal_kb_changed INTEGER NOT NULL,
      shared_knowledge_updated INTEGER NOT NULL,
      shared_knowledge_seeded INTEGER NOT NULL,
      quality_delta REAL NOT NULL,
      confidence_delta REAL NOT NULL,
      attempted INTEGER NOT NULL,
      applied INTEGER NOT NULL,
      cooldown_skipped INTEGER NOT NULL,
      evidence_score REAL NOT NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reinforcement_events_quarantine_original_event_id
    ON reinforcement_events_quarantine(original_event_id)
  `);
}

async function quarantineAndDeleteChunk(
  client: ReturnType<typeof createClient>,
  ids: number[],
): Promise<{ quarantined: number; deleted: number }> {
  const placeholders = ids.map(() => "?").join(", ");

  await client.execute("BEGIN");
  try {
    const inserted = await client.execute({
      sql: `
        INSERT INTO reinforcement_events_quarantine (
          quarantine_reason,
          original_event_id,
          timestamp,
          event_type,
          source,
          verdict,
          verdict_origin,
          issue_pattern,
          file_path,
          agent_id,
          agent_name,
          agent_role,
          finding_id,
          linked_context,
          personal_kb_action,
          personal_kb_changed,
          shared_knowledge_updated,
          shared_knowledge_seeded,
          quality_delta,
          confidence_delta,
          attempted,
          applied,
          cooldown_skipped,
          evidence_score
        )
        SELECT
          ?,
          id,
          timestamp,
          event_type,
          source,
          verdict,
          verdict_origin,
          issue_pattern,
          file_path,
          agent_id,
          agent_name,
          agent_role,
          finding_id,
          linked_context,
          personal_kb_action,
          personal_kb_changed,
          shared_knowledge_updated,
          shared_knowledge_seeded,
          quality_delta,
          confidence_delta,
          attempted,
          applied,
          cooldown_skipped,
          evidence_score
        FROM reinforcement_events
        WHERE id IN (${placeholders})
      `,
      args: ["synthetic-reinforcement-event", ...ids],
    });

    const deleted = await client.execute({
      sql: `DELETE FROM reinforcement_events WHERE id IN (${placeholders})`,
      args: ids,
    });

    await client.execute("COMMIT");

    return {
      quarantined: toRowsAffected(inserted),
      deleted: toRowsAffected(deleted),
    };
  } catch (error) {
    await client.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = resolveDbPath();

  console.log("Reinforcement data cleanup");
  console.log(`DB path: ${dbPath}`);
  console.log(`Mode: ${flags.apply ? "apply" : "dry-run"}`);

  const client = createClient({ url: `file:${dbPath}` });

  try {
    const result = await client.execute(`
      SELECT
        id,
        source,
        verdict_origin,
        finding_id
      FROM reinforcement_events
      ORDER BY id
    `);

    const rows: ReinforcementEventRow[] = result.rows.map((row) => ({
      id: toNumber(row["id"]),
      source: toText(row["source"]),
      verdictOrigin: toOptionalText(row["verdict_origin"]),
      findingId: toOptionalText(row["finding_id"]),
    }));

    const bySource = new Map<string, SourceBreakdown>();
    const byReason: ReasonBreakdown = {};
    const syntheticIds: number[] = [];

    for (const row of rows) {
      const sourceKey = row.source || "(empty)";
      const sourceStats = bySource.get(sourceKey) ?? { total: 0, synthetic: 0 };
      sourceStats.total += 1;

      const classification = classifyReinforcementEvent({
        source: row.source,
        verdictOrigin: row.verdictOrigin,
        findingId: row.findingId,
      });

      if (classification.synthetic) {
        syntheticIds.push(row.id);
        sourceStats.synthetic += 1;
        byReason[classification.reason] = (byReason[classification.reason] ?? 0) + 1;
      }

      bySource.set(sourceKey, sourceStats);
    }

    const syntheticCount = syntheticIds.length;
    const totalCount = rows.length;
    const realCount = totalCount - syntheticCount;

    console.log(`Rows scanned: ${totalCount}`);
    console.log(`Synthetic rows: ${syntheticCount}`);
    console.log(`Real rows: ${realCount}`);

    printReasonBreakdown(byReason);
    printSourceBreakdown(bySource);

    if (!flags.apply) {
      console.log("Dry-run mode complete. No rows were modified.");
      return;
    }

    if (syntheticCount === 0) {
      console.log("Apply mode complete. No synthetic rows found, so no deletions were performed.");
      return;
    }

    await ensureQuarantineTable(client);

    let quarantinedTotal = 0;
    let deletedTotal = 0;

    for (let index = 0; index < syntheticIds.length; index += CHUNK_SIZE) {
      const chunk = syntheticIds.slice(index, index + CHUNK_SIZE);
      const resultChunk = await quarantineAndDeleteChunk(client, chunk);
      quarantinedTotal += resultChunk.quarantined;
      deletedTotal += resultChunk.deleted;
      console.log(`Processed chunk ${Math.floor(index / CHUNK_SIZE) + 1}: rows=${chunk.length}, quarantined=${resultChunk.quarantined}, deleted=${resultChunk.deleted}`);
    }

    console.log(`Apply mode complete. Quarantined rows: ${quarantinedTotal}. Deleted rows: ${deletedTotal}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`cleanup-reinforcement-data failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void main();
