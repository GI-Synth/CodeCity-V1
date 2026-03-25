/**
 * seed-knowledge-v2.ts — Seeds 500+ KB entries across 9 domains.
 *
 * Run: npx tsx scripts/seed-knowledge-v2.ts
 *
 * Each chunk file (seed-knowledge-v2-*.ts) exports a getEntries() function.
 * This orchestrator imports them all, deduplicates by title, and inserts.
 */
import path from "path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../lib/db/src/schema";
import { sql } from "drizzle-orm";

export interface SeedEntry {
  title: string;
  content: string;
  domain: string;
  problemType: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  tags: string[];
}

// ── Database setup ────────────────────────────────────────────
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(process.cwd(), "artifacts/api-server/data/city.db");

function getDb() {
  const client = createClient({ url: `file:${dbPath}` });
  return drizzle(client, { schema });
}

// ── Chunk imports ─────────────────────────────────────────────
import { getEntries as security1 } from "./seed-chunks/security-1";
import { getEntries as security2 } from "./seed-chunks/security-2";
import { getEntries as perf1 } from "./seed-chunks/performance-1";
import { getEntries as perf2 } from "./seed-chunks/performance-2";
import { getEntries as arch1 } from "./seed-chunks/architecture-1";
import { getEntries as arch2 } from "./seed-chunks/architecture-2";
import { getEntries as ts1 } from "./seed-chunks/typescript-1";
import { getEntries as ts2 } from "./seed-chunks/typescript-2";
import { getEntries as react1 } from "./seed-chunks/react-1";
import { getEntries as react2 } from "./seed-chunks/react-2";
import { getEntries as testing1 } from "./seed-chunks/testing-1";
import { getEntries as testing2 } from "./seed-chunks/testing-2";
import { getEntries as nodejs1 } from "./seed-chunks/nodejs-1";
import { getEntries as nodejs2 } from "./seed-chunks/nodejs-2";
import { getEntries as docs1 } from "./seed-chunks/documentation-1";
import { getEntries as docs2 } from "./seed-chunks/documentation-2";
import { getEntries as gen1 } from "./seed-chunks/general-1";
import { getEntries as gen2 } from "./seed-chunks/general-2";
import { getEntries as gen3 } from "./seed-chunks/general-3";
import { getEntries as gen4 } from "./seed-chunks/general-4";

async function main() {
  const db = getDb();

  // Gather all entries
  const allEntries: SeedEntry[] = [
    ...security1(), ...security2(),
    ...perf1(), ...perf2(),
    ...arch1(), ...arch2(),
    ...ts1(), ...ts2(),
    ...react1(), ...react2(),
    ...testing1(), ...testing2(),
    ...nodejs1(), ...nodejs2(),
    ...docs1(), ...docs2(),
    ...gen1(), ...gen2(), ...gen3(), ...gen4(),
  ];

  // Deduplicate by title
  const seen = new Set<string>();
  const unique: SeedEntry[] = [];
  for (const entry of allEntries) {
    const key = entry.title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }

  console.log(`[SeedV2] ${unique.length} unique entries from ${allEntries.length} total`);

  // Check current count
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.knowledgeTable);
  const currentCount = row?.count ?? 0;
  console.log(`[SeedV2] Current KB entries: ${currentCount}`);

  // Insert in batches
  let inserted = 0;
  const BATCH = 25;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const values = batch.map((e) => ({
      question: e.title,
      answer: e.content,
      problemType: e.problemType,
      language: "typescript",
      framework: "",
      patternTags: JSON.stringify(e.tags),
      fileType: "",
      confidence: String(e.confidence),
      provider: "seed-v2",
      domain: e.domain,
      qualityScore: e.confidence,
      wasUseful: 1,
      producedBugs: 0,
      useCount: 0,
    }));

    await db.insert(schema.knowledgeTable).values(values);
    inserted += batch.length;
  }

  console.log(`[SeedV2] Inserted ${inserted} entries. New total: ${currentCount + inserted}`);
}

// Direct execution guard
const isDirectRun =
  process.argv[1]?.endsWith("seed-knowledge-v2.ts") ||
  process.argv[1]?.endsWith("seed-knowledge-v2");

if (isDirectRun) {
  main().catch((err) => {
    console.error("[SeedV2] Failed:", err);
    process.exit(1);
  });
}

export { main as seedKnowledgeV2 };
