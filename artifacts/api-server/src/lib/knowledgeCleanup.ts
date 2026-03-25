import { db } from "@workspace/db";
import { agentsTable, eventsTable, knowledgeTable, reposTable } from "@workspace/db/schema";
import { and, count, desc, eq, inArray, like, or } from "drizzle-orm";
import type { CityLayout } from "./types";
import { isSourceFile } from "./sourceFiles";
import { invalidateKnowledgeSearchCache } from "./vectorSearch";

const STARTUP_LANGUAGE_PURGE = ["markdown", "html", "text"] as const;
const FIX1_MARKUP_LANGUAGES = ["markdown", "html"] as const;
const NON_SOURCE_LANGUAGES = ["markdown", "html", "text", "yaml", "yml", "json", "txt"] as const;
const NON_SOURCE_FILE_TYPES = ["markdown", "md", "html", "txt", "yaml", "yml", "json", "text", "docs", "doc"] as const;
const FIX1_QUESTION_PATTERNS = ["%README%", "%.md%", "%index.html%"] as const;
const NON_SOURCE_QUESTION_PATTERNS = [
  "%README%",
  "%.md%",
  "%index.html%",
  "%.html%",
  "%.txt%",
  "%.yaml%",
  "%.yml%",
  "%.json%",
] as const;
const BUG_EVENT_TYPES = ["bug_found", "task_complete", "test_passed"] as const;

type CleanupResult = {
  removed: number;
  remaining: number;
  bugsFound: number;
};

function isSqliteCorruptionError(error: unknown): boolean {
  const messages: string[] = [];

  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }

    messages.push(String(current));
    break;
  }

  const lower = messages.join(" | ").toLowerCase();
  return (
    lower.includes("sqlite_corrupt")
    || lower.includes("sqlite_corrupt_vtab")
    || lower.includes("database disk image is malformed")
  );
}

function logCleanupSkip(reason: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[KBCleanup] ${reason}: ${detail.slice(0, 240)}`);
}

type EventForRecount = {
  type: string;
  message: string;
  agentId: string | null;
  buildingId: string | null;
  buildingName: string | null;
};

function parseBugCountFromEvent(event: EventForRecount): number {
  const message = event.message.toLowerCase();

  if (event.type === "test_passed") {
    const failedMatch = message.match(/(\d+)\s+failed/);
    return failedMatch ? Number.parseInt(failedMatch[1], 10) : 0;
  }

  const explicitCount = message.match(/found\s+(\d+)\s+bug/);
  if (explicitCount) return Number.parseInt(explicitCount[1], 10);

  return message.includes("found") && message.includes("bug") ? 1 : 0;
}

function resolveEventFilePath(event: EventForRecount, byBuildingId: Map<string, string>): string | null {
  if (event.buildingId) {
    const byId = byBuildingId.get(event.buildingId);
    if (byId) return byId;
  }

  const byName = event.buildingName?.trim();
  if (!byName) return null;
  return byName;
}

async function loadBuildingPathIndex(): Promise<Map<string, string>> {
  const byBuildingId = new Map<string, string>();

  const activeRepo = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
  const repo = activeRepo[0]
    ?? (await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1))[0]
    ?? null;

  if (!repo?.layoutData) return byBuildingId;

  try {
    const layout = JSON.parse(repo.layoutData) as CityLayout;
    for (const district of layout.districts) {
      for (const building of district.buildings) {
        byBuildingId.set(building.id, building.filePath);
      }
    }
  } catch {
    return byBuildingId;
  }

  return byBuildingId;
}

async function countKnowledgeEntries(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(knowledgeTable);
  return row?.total ?? 0;
}

function buildFix1WhereClause() {
  const questionMatchers = FIX1_QUESTION_PATTERNS.map((pattern) => like(knowledgeTable.question, pattern));

  return or(
    inArray(knowledgeTable.language, [...FIX1_MARKUP_LANGUAGES]),
    ...questionMatchers,
    and(
      eq(knowledgeTable.problemType, "test_generation"),
      inArray(knowledgeTable.language, [...FIX1_MARKUP_LANGUAGES]),
    ),
  );
}

function buildNonSourceWhereClause() {
  const questionMatchers = NON_SOURCE_QUESTION_PATTERNS.map((pattern) => like(knowledgeTable.question, pattern));

  return or(
    buildFix1WhereClause(),
    inArray(knowledgeTable.language, [...NON_SOURCE_LANGUAGES]),
    inArray(knowledgeTable.fileType, [...NON_SOURCE_FILE_TYPES]),
    ...questionMatchers,
  );
}

async function deleteKnowledgeByPredicate(predicate: ReturnType<typeof buildNonSourceWhereClause>): Promise<number> {
  const before = await countKnowledgeEntries();
  try {
    await db.delete(knowledgeTable).where(predicate);
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      logCleanupSkip("Skipping non-source knowledge cleanup due SQLite corruption", error);
      return 0;
    }
    throw error;
  }

  const after = await countKnowledgeEntries();
  const removed = Math.max(0, before - after);
  if (removed > 0) {
    invalidateKnowledgeSearchCache({ resetVectorCache: true });
  }

  return removed;
}

async function recountAgentBugCountersFromSourceEvents(): Promise<number> {
  const agents = await db.select({ id: agentsTable.id }).from(agentsTable);
  const byAgentId = new Map<string, number>(agents.map((agent) => [agent.id, 0]));

  const events = await db
    .select({
      type: eventsTable.type,
      message: eventsTable.message,
      agentId: eventsTable.agentId,
      buildingId: eventsTable.buildingId,
      buildingName: eventsTable.buildingName,
    })
    .from(eventsTable)
    .where(inArray(eventsTable.type, [...BUG_EVENT_TYPES]));

  const byBuildingId = await loadBuildingPathIndex();

  for (const event of events) {
    if (!event.agentId || !byAgentId.has(event.agentId)) continue;

    const bugCount = parseBugCountFromEvent(event);
    if (bugCount <= 0) continue;

    const filePath = resolveEventFilePath(event, byBuildingId);
    if (!filePath || !isSourceFile(filePath)) continue;

    byAgentId.set(event.agentId, (byAgentId.get(event.agentId) ?? 0) + bugCount);
  }

  for (const [agentId, bugsFound] of byAgentId.entries()) {
    await db.update(agentsTable).set({ bugsFound }).where(eq(agentsTable.id, agentId));
  }

  return Array.from(byAgentId.values()).reduce((sum, value) => sum + value, 0);
}

export async function hasMarkdownOrHtmlKnowledgeEntries(): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(knowledgeTable)
    .where(inArray(knowledgeTable.language, [...FIX1_MARKUP_LANGUAGES]));

  return (row?.total ?? 0) > 0;
}

export async function purgeStartupKnowledgeLanguages(): Promise<number> {
  const before = await countKnowledgeEntries();

  try {
    await db.delete(knowledgeTable).where(inArray(knowledgeTable.language, [...STARTUP_LANGUAGE_PURGE]));
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      logCleanupSkip("Skipping startup language purge due SQLite corruption", error);
      return 0;
    }
    throw error;
  }

  const after = await countKnowledgeEntries();
  const removed = Math.max(0, before - after);
  if (removed > 0) {
    invalidateKnowledgeSearchCache({ resetVectorCache: true });
  }

  return removed;
}

export async function cleanupNonSourceKnowledgeAndRecountBugs(): Promise<CleanupResult> {
  const removed = await deleteKnowledgeByPredicate(buildNonSourceWhereClause());
  const remaining = await countKnowledgeEntries();
  const bugsFound = await recountAgentBugCountersFromSourceEvents();

  return { removed, remaining, bugsFound };
}
