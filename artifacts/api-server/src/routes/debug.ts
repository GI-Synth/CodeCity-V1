import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { findingsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

type FindingDecision = "bug" | "observation" | "discard";

function toDecision(classification: string): FindingDecision {
  if (classification === "bug") return "bug";
  if (classification === "observation") return "observation";
  return "discard";
}

function parseMetadataReason(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const metadata = parsed as Record<string, unknown>;
    const qualityReason = metadata["qualityReason"];
    if (typeof qualityReason === "string" && qualityReason.trim().length > 0) {
      return qualityReason.trim();
    }

    const reason = metadata["reason"];
    if (typeof reason === "string" && reason.trim().length > 0) {
      return reason.trim();
    }

    const qualityStatus = metadata["qualityStatus"];
    if (typeof qualityStatus === "string" && qualityStatus.trim().length > 0) {
      return qualityStatus.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function fallbackReason(classification: string): string {
  if (classification === "bug") return "accepted";
  if (classification === "observation") return "observation";
  if (classification === "discarded") return "discarded";
  if (classification === "no_finding") return "no_finding";
  return "discarded";
}

// Debug-only endpoint for trust-gate inspection. Remove in production.
router.get("/findings-pipeline", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        filePath: findingsTable.filePath,
        baseConfidence: findingsTable.baseConfidence,
        finalConfidence: findingsTable.finalConfidence,
        classification: findingsTable.classification,
        metadata: findingsTable.metadata,
        createdAt: findingsTable.createdAt,
      })
      .from(findingsTable)
      .orderBy(desc(findingsTable.id))
      .limit(10);

    const attempts = rows.map((row) => ({
      filePath: row.filePath,
      rawConfidence: row.baseConfidence,
      calibratedConfidence: row.finalConfidence,
      decision: toDecision(row.classification),
      reason: parseMetadataReason(row.metadata) ?? fallbackReason(row.classification),
      timestamp: row.createdAt,
    }));

    res.json({ attempts, count: attempts.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "DEBUG_FINDINGS_PIPELINE_ERROR", message });
  }
});

export default router;
