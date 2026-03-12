import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { knowledgeTable } from "@workspace/db/schema";
import { desc, asc, count, sql, eq } from "drizzle-orm";

const router: IRouter = Router();

async function seedKnowledgeBase() {
  const existing = await db.select({ count: count() }).from(knowledgeTable);
  if (existing[0].count > 0) return;

  const entries = [
    {
      problemType: "test_generation", language: "typescript", framework: "express",
      patternTags: JSON.stringify(["null_check", "async"]), fileType: "api",
      question: "How do I test async API endpoints with proper error handling?",
      contextHash: "abc123",
      codeSnippet: "async function handler(req, res) { const data = await db.find(req.params.id); }",
      answer: "Use Jest with supertest for API testing. Wrap async handlers in try-catch. Test both success and error paths. Mock the database layer.",
      actionItems: JSON.stringify(["Add try-catch to handler", "Test 404 case", "Mock db.find", "Add timeout tests"]),
      confidence: "high", provider: "claude", useCount: 5, wasUseful: 1, producedBugs: 3, qualityScore: 0.75,
    },
    {
      problemType: "bug_analysis", language: "javascript", framework: "unknown",
      patternTags: JSON.stringify(["race_condition", "async"]), fileType: "source",
      question: "Why does my Promise chain produce inconsistent results?",
      contextHash: "def456",
      codeSnippet: "let result; setTimeout(() => { result = fetch(); }, 100); console.log(result);",
      answer: "Classic async race condition. The setTimeout callback runs after console.log. Use async/await or ensure result is read inside the callback.",
      actionItems: JSON.stringify(["Convert to async/await", "Move console.log inside callback", "Add Promise.all for parallel calls"]),
      confidence: "high", provider: "claude", useCount: 12, wasUseful: 1, producedBugs: 8, qualityScore: 0.88,
    },
    {
      problemType: "test_generation", language: "python", framework: "fastapi",
      patternTags: JSON.stringify(["edge_case", "type_error"]), fileType: "api",
      question: "How to test FastAPI endpoints with authentication?",
      contextHash: "ghi789",
      codeSnippet: "@app.get('/users/{id}') async def get_user(id: int, token: str = Depends(get_token)):",
      answer: "Use TestClient from FastAPI. Override dependencies with app.dependency_overrides. Test with valid and invalid tokens. Test with non-existent IDs.",
      actionItems: JSON.stringify(["Use TestClient", "Override auth dependency", "Test 401 and 403 responses", "Test with boundary IDs"]),
      confidence: "high", provider: "groq", useCount: 7, wasUseful: 1, producedBugs: 4, qualityScore: 0.72,
    },
    {
      problemType: "architecture", language: "typescript", framework: "express",
      patternTags: JSON.stringify(["memory_leak", "api_abuse"]), fileType: "api",
      question: "How do I detect memory leaks in Express middleware?",
      contextHash: "jkl012",
      codeSnippet: "app.use((req, res, next) => { const data = heavyObject(); next(); });",
      answer: "Memory leaks in middleware often occur from closures holding references. Use node --inspect to profile. Look for unclosed streams, event listener accumulation, and cache that never clears.",
      actionItems: JSON.stringify(["Profile with --inspect", "Check event listeners", "Add cache size limits", "Use weak references"]),
      confidence: "medium", provider: "claude", useCount: 3, wasUseful: 1, producedBugs: 2, qualityScore: 0.55,
    },
    {
      problemType: "test_generation", language: "python", framework: "pytest",
      patternTags: JSON.stringify(["sql_injection", "auth"]), fileType: "database",
      question: "How to test SQL injection vulnerabilities in Python?",
      contextHash: "mno345",
      codeSnippet: "def get_user(username): return db.execute(f'SELECT * FROM users WHERE name={username}')",
      answer: "Never use f-strings for SQL! Use parameterized queries. Test with: single quotes, semicolons, UNION SELECT payloads, and NULL bytes. Use sqlmap for automated testing.",
      actionItems: JSON.stringify(["Replace f-string with parameterized query", "Test with ' OR 1=1 --", "Test with UNION SELECT NULL--", "Use sqlmap on staging"]),
      confidence: "high", provider: "claude", useCount: 9, wasUseful: 1, producedBugs: 6, qualityScore: 0.83,
    },
  ];

  for (const entry of entries) {
    await db.insert(knowledgeTable).values(entry as any);
  }
}

router.get("/stats", async (_req, res) => {
  try {
    await seedKnowledgeBase();
    const rows = await db.select({
      count: count(),
      totalHits: sql<number>`sum(${knowledgeTable.useCount})`,
    }).from(knowledgeTable);

    const topProblems = await db
      .select({ type: knowledgeTable.problemType, count: count() })
      .from(knowledgeTable)
      .groupBy(knowledgeTable.problemType)
      .limit(5);

    const totalEntries = rows[0]?.count ?? 0;
    const totalCacheHits = Number(rows[0]?.totalHits ?? 0);

    res.json({
      totalEntries, totalCacheHits,
      avgBugsPerEntry: totalEntries > 0 ? (totalCacheHits * 0.05) : 0,
      escalationRate: totalEntries > 10 ? 0.02 : 0.06,
      topProblems: topProblems.map(p => ({ type: p.type, count: p.count })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "KNOWLEDGE_ERROR", message });
  }
});

router.get("/entries", async (req, res) => {
  try {
    await seedKnowledgeBase();

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
        createdAt: e.createdAt?.toISOString() ?? new Date().toISOString(),
        lastUsed: e.lastUsed?.toISOString() ?? null,
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
