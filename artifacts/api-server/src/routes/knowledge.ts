import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { knowledgeTable, eventsTable } from "@workspace/db/schema";
import { desc, asc, count, sql, eq, like, or, inArray } from "drizzle-orm";
import { getKbSessionStats } from "../lib/sessionStats";
import { getVectorCacheSize } from "../lib/vectorSearch";
import { isEmbeddingModelLoaded } from "../lib/embeddings";

const router: IRouter = Router();

const LEGACY_SEED_CONTEXT_HASHES = ["abc123", "def456", "ghi789", "jkl012", "mno345"];
let cleanedLegacySeedKnowledge = false;

async function purgeLegacySeedKnowledgeEntries(): Promise<void> {
  if (cleanedLegacySeedKnowledge) return;

  await db.delete(knowledgeTable).where(
    inArray(knowledgeTable.contextHash, LEGACY_SEED_CONTEXT_HASHES)
  );

  cleanedLegacySeedKnowledge = true;
}

router.get("/stats", async (_req, res) => {
  try {
    await purgeLegacySeedKnowledgeEntries();

    const rows = await db.select({
      count: count(),
      totalHits: sql<number>`sum(${knowledgeTable.useCount})`,
      totalProducedBugs: sql<number>`sum(${knowledgeTable.producedBugs})`,
    }).from(knowledgeTable);

    const eventRows = await db.select({
      total: count(),
      escalations: sql<number>`sum(case when ${eventsTable.type} = 'escalation' then 1 else 0 end)`,
    }).from(eventsTable);

    const topProblems = await db
      .select({ type: knowledgeTable.problemType, count: count() })
      .from(knowledgeTable)
      .groupBy(knowledgeTable.problemType)
      .limit(5);

    const totalEntries = rows[0]?.count ?? 0;
    const totalCacheHits = Number(rows[0]?.totalHits ?? 0);
    const totalProducedBugs = Number(rows[0]?.totalProducedBugs ?? 0);
    const totalEvents = Number(eventRows[0]?.total ?? 0);
    const escalationEvents = Number(eventRows[0]?.escalations ?? 0);

    res.json({
      totalEntries, totalCacheHits,
      avgBugsPerEntry: totalEntries > 0 ? totalProducedBugs / totalEntries : 0,
      escalationRate: totalEvents > 0 ? escalationEvents / totalEvents : 0,
      topProblems: topProblems.map(p => ({ type: p.type, count: p.count })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "KNOWLEDGE_ERROR", message });
  }
});

router.get("/session-stats", (_req, res) => {
  const stats = getKbSessionStats();
  res.json({
    ...stats,
    vectorCacheSize: getVectorCacheSize(),
    modelLoaded: isEmbeddingModelLoaded(),
  });
});

router.get("/entries", async (req, res) => {
  try {
    await purgeLegacySeedKnowledgeEntries();

    const sortParam = typeof req.query["sort"] === "string" ? req.query["sort"] : "quality";
    const page = Math.max(1, parseInt(typeof req.query["page"] === "string" ? req.query["page"] : "1"));
    const limit = Math.min(50, Math.max(1, parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "20")));
    const offset = (page - 1) * limit;

    const orderBy = sortParam === "uses" ? desc(knowledgeTable.useCount)
      : sortParam === "date" ? desc(knowledgeTable.createdAt)
      : sortParam === "language" ? asc(knowledgeTable.language)
      : desc(knowledgeTable.qualityScore);

    const [totalRow] = await db.select({ count: count() }).from(knowledgeTable);
    const entries = await db.select().from(knowledgeTable).orderBy(orderBy).limit(limit).offset(offset);

    res.json({
      entries: entries.map(e => ({
        id: e.id, problemType: e.problemType, language: e.language,
        question: e.question,
        answer: e.answer.slice(0, 200) + (e.answer.length > 200 ? "..." : ""),
        confidence: e.confidence, provider: e.provider, useCount: e.useCount,
        qualityScore: e.qualityScore ?? 0.5,
        producedBugs: e.producedBugs,
        createdAt: e.createdAt ?? new Date().toISOString(),
        lastUsed: e.lastUsed ?? null,
      })),
      total: totalRow.count,
      page, limit,
      totalPages: Math.ceil(totalRow.count / limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "ENTRIES_ERROR", message });
  }
});

router.get("/search", async (req, res) => {
  try {
    await purgeLegacySeedKnowledgeEntries();

    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const limit = Math.min(50, parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "20"));

    if (!q) {
      res.json({ entries: [], total: 0, query: q });
      return;
    }

    const pattern = `%${q}%`;
    const entries = await db
      .select()
      .from(knowledgeTable)
      .where(
        or(
          like(knowledgeTable.question, pattern),
          like(knowledgeTable.answer, pattern),
          like(knowledgeTable.problemType, pattern),
          like(knowledgeTable.language, pattern),
          like(knowledgeTable.framework, pattern),
        )
      )
      .orderBy(desc(knowledgeTable.qualityScore))
      .limit(limit);

    res.json({
      entries: entries.map(e => ({
        id: e.id, problemType: e.problemType, language: e.language,
        question: e.question,
        answer: e.answer.slice(0, 200) + (e.answer.length > 200 ? "..." : ""),
        confidence: e.confidence, provider: e.provider, useCount: e.useCount,
        qualityScore: e.qualityScore ?? 0.5,
        producedBugs: e.producedBugs,
        createdAt: e.createdAt ?? new Date().toISOString(),
        lastUsed: e.lastUsed ?? null,
      })),
      total: entries.length,
      query: q,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SEARCH_ERROR", message });
  }
});

router.post("/import", async (req, res) => {
  try {
    const body = req.body;
    const rawEntries: any[] = Array.isArray(body) ? body : (Array.isArray(body?.entries) ? body.entries : []);

    if (rawEntries.length === 0) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Expected an array of entries or { entries: [...] }" });
      return;
    }

    let imported = 0;
    let skipped = 0;

    for (const raw of rawEntries) {
      try {
        const entry = {
          problemType: String(raw.problemType ?? raw.problem_type ?? "unknown"),
          language: String(raw.language ?? "unknown"),
          framework: raw.framework ? String(raw.framework) : null,
          patternTags: raw.patternTags ? (typeof raw.patternTags === "string" ? raw.patternTags : JSON.stringify(raw.patternTags)) : null,
          fileType: raw.fileType ? String(raw.fileType) : null,
          question: String(raw.question ?? ""),
          contextHash: raw.contextHash ? String(raw.contextHash) : null,
          codeSnippet: raw.codeSnippet ? String(raw.codeSnippet) : null,
          answer: String(raw.answer ?? ""),
          actionItems: raw.actionItems ? (typeof raw.actionItems === "string" ? raw.actionItems : JSON.stringify(raw.actionItems)) : null,
          confidence: ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "medium",
          provider: String(raw.provider ?? "import"),
          useCount: typeof raw.useCount === "number" ? raw.useCount : 1,
          wasUseful: typeof raw.wasUseful === "number" ? raw.wasUseful : 1,
          producedBugs: typeof raw.producedBugs === "number" ? raw.producedBugs : 0,
          qualityScore: typeof raw.qualityScore === "number" ? Math.min(1, Math.max(0, raw.qualityScore)) : 0.5,
        };

        if (!entry.question || !entry.answer) { skipped++; continue; }

        await db.insert(knowledgeTable).values(entry as any);
        imported++;
      } catch {
        skipped++;
      }
    }

    res.json({ success: true, imported, skipped, total: rawEntries.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "IMPORT_ERROR", message });
  }
});

router.delete("/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "INVALID_ID" });
    return;
  }
  try {
    await db.delete(knowledgeTable).where(eq(knowledgeTable.id, id));
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "DELETE_ERROR", message });
  }
});

router.get("/export", async (_req, res) => {
  try {
    await purgeLegacySeedKnowledgeEntries();

    const entries = await db.select().from(knowledgeTable).orderBy(desc(knowledgeTable.qualityScore));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="knowledge-base-${Date.now()}.json"`);
    res.json({ exportedAt: new Date().toISOString(), entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "EXPORT_ERROR", message });
  }
});

export default router;
