#!/usr/bin/env node
// analyze-repo.ts: CLI to analyze the current repo and print summary stats
import { createClient } from "@libsql/client";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, "artifacts/api-server/data/city.db");
const db = createClient({ url: `file:${DB_PATH}` });

type AnyRow = Record<string, unknown>;

async function existingTables(): Promise<Set<string>> {
  const rows = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const names = rows.rows.map((row) => String((row as AnyRow).name ?? ""));
  return new Set(names);
}

function firstExistingTable(tableSet: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (tableSet.has(candidate)) return candidate;
  }
  return null;
}

async function safeCount(tableName: string | null): Promise<number> {
  if (!tableName) return 0;
  try {
    const rows = await db.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
    const value = (rows.rows[0] as AnyRow | undefined)?.count;
    return Number(value ?? 0);
  } catch {
    return 0;
  }
}

async function main() {
  const tables = await existingTables();
  const repoTable = firstExistingTable(tables, ["repos"]);
  const agentTable = firstExistingTable(tables, ["agents"]);
  const knowledgeTable = firstExistingTable(tables, ["knowledge", "knowledge_entries"]);
  const eventTable = firstExistingTable(tables, ["events"]);

  const repoRows = repoTable ? await db.execute(`SELECT * FROM ${repoTable} LIMIT 1`) : { rows: [] };
  const repo = (repoRows.rows[0] as AnyRow | undefined) ?? null;

  const agentsCount = await safeCount(agentTable);
  const knowledgeCount = await safeCount(knowledgeTable);

  let eventRows: AnyRow[] = [];
  if (eventTable) {
    try {
      const rows = await db.execute(`SELECT type FROM ${eventTable}`);
      eventRows = rows.rows as AnyRow[];
    } catch {
      eventRows = [];
    }
  }

  const bugs = eventRows.filter((e) => String(e.type ?? "") === "bug_found");

  console.log("--- Software City Repo Analysis ---");
  if (repo) {
    const repoName = String(repo.repo_name ?? repo.repoName ?? repo.name ?? "(unknown)");
    const layoutData = repo.layout_data ?? repo.layoutData;
    console.log(`Repo: ${repoName}`);
    console.log(`Layout: ${layoutData ? "Loaded" : "Missing"}`);
  }
  console.log(`Agents: ${agentsCount}`);
  console.log(`Knowledge Base Entries: ${knowledgeCount}`);
  console.log(`Events: ${eventRows.length}`);
  console.log(`Bugs Found: ${bugs.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
