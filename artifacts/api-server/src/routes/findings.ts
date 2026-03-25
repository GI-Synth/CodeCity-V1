import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { findingsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /api/findings
 * Returns recent findings with optional filters.
 * Query params:
 *   limit    — max rows (default 50, max 200)
 *   agentId  — filter by agent
 *   buildingId — filter by building
 *   severity — filter by severity (CRITICAL|HIGH|MEDIUM|LOW)
 *   classification — filter by classification (bug|observation|discarded|no_finding|test_target)
 */
router.get("/", async (req, res) => {
  try {
    const rawLimit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 50));

    const agentId = typeof req.query["agentId"] === "string" ? req.query["agentId"] : null;
    const buildingId = typeof req.query["buildingId"] === "string" ? req.query["buildingId"] : null;
    const severity = typeof req.query["severity"] === "string" ? req.query["severity"] : null;
    const classification = typeof req.query["classification"] === "string" ? req.query["classification"] : null;

    const conditions = [];
    if (agentId) conditions.push(eq(findingsTable.agentId, agentId));
    if (buildingId) conditions.push(eq(findingsTable.buildingId, buildingId));
    if (severity) conditions.push(eq(findingsTable.severity, severity));
    if (classification) conditions.push(eq(findingsTable.classification, classification));

    const rows = await db
      .select()
      .from(findingsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(findingsTable.createdAt))
      .limit(limit);

    const findings = rows.map(row => {
      let parsedMetadata: Record<string, unknown> = {};
      try {
        if (row.metadata) {
          parsedMetadata = JSON.parse(row.metadata) as Record<string, unknown>;
        }
      } catch { }

      return {
        ...row,
        metadata: parsedMetadata,
        suggestedFix: typeof parsedMetadata["suggestedFix"] === "string"
          ? parsedMetadata["suggestedFix"]
          : null,
      };
    });

    res.json({ findings, total: findings.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "FINDINGS_ERROR", message });
  }
});

/**
 * GET /api/findings/:id
 * Returns a single finding by ID.
 */
router.get("/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "INVALID_ID" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }

    const row = rows[0];
    let parsedMetadata: Record<string, unknown> = {};
    try {
      if (row.metadata) {
        parsedMetadata = JSON.parse(row.metadata) as Record<string, unknown>;
      }
    } catch { }

    res.json({
      ...row,
      metadata: parsedMetadata,
      suggestedFix: typeof parsedMetadata["suggestedFix"] === "string"
        ? parsedMetadata["suggestedFix"]
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "FINDINGS_ERROR", message });
  }
});

export default router;
