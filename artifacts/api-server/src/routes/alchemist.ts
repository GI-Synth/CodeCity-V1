import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eventsTable, executionResultsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { runAlchemistCommand } from "../lib/alchemistExecutor";
import { wsServer } from "../lib/wsServer";

const router: IRouter = Router();

function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function eventSeverityForStatus(status: string): "info" | "warning" | "critical" {
  if (status === "success") return "info";
  if (status === "blocked") return "warning";
  return "critical";
}

router.post("/run", async (req, res): Promise<void> => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
  const timeoutMs = typeof req.body?.timeoutMs === "number" ? req.body.timeoutMs : undefined;
  const triggeredBy = typeof req.body?.triggeredBy === "string" ? req.body.triggeredBy.trim() : "alchemist";

  if (!command) {
    res.status(400).json({ error: "INVALID_COMMAND", message: "command is required" });
    return;
  }

  try {
    const execution = await runAlchemistCommand({ command, timeoutMs });

    const inserted = await db.insert(executionResultsTable).values({
      command: execution.command,
      status: execution.status,
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
      durationMs: execution.durationMs,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      triggeredBy,
    }).returning({ id: executionResultsTable.id });

    const resultId = inserted[0]?.id ?? null;
    const severity = eventSeverityForStatus(execution.status);
    const commandPreview = execution.command.length > 80
      ? `${execution.command.slice(0, 80)}...`
      : execution.command;

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-alchemy-${Math.random().toString(36).slice(2, 5)}`,
      type: "alchemist_run",
      message: `Alchemist ${execution.status}: ${commandPreview}`,
      severity,
    }).catch(() => {});

    wsServer.broadcastEventLog("ALCHEMIST", `Alchemist ${execution.status}: ${commandPreview}`, severity);
    wsServer.broadcastAlchemistResult({
      id: resultId,
      command: execution.command,
      status: execution.status,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      reason: execution.reason ?? null,
    });

    res.json({
      id: resultId,
      ...execution,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "ALCHEMIST_RUN_ERROR", message });
  }
});

router.get("/results", async (req, res): Promise<void> => {
  try {
    const limit = normalizeLimit(req.query?.limit);
    const results = await db
      .select()
      .from(executionResultsTable)
      .orderBy(desc(executionResultsTable.id))
      .limit(limit);

    res.json({ results, total: results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "ALCHEMIST_RESULTS_ERROR", message });
  }
});

router.get("/summary", async (_req, res): Promise<void> => {
  try {
    const recent = await db
      .select()
      .from(executionResultsTable)
      .orderBy(desc(executionResultsTable.id))
      .limit(100);

    const totals = {
      totalRuns: recent.length,
      success: 0,
      failed: 0,
      blocked: 0,
      timeout: 0,
    };

    for (const row of recent) {
      if (row.status === "success") totals.success += 1;
      else if (row.status === "failed") totals.failed += 1;
      else if (row.status === "blocked") totals.blocked += 1;
      else if (row.status === "timeout") totals.timeout += 1;
    }

    const successRate = totals.totalRuns > 0
      ? totals.success / totals.totalRuns
      : 0;

    res.json({
      ...totals,
      successRate,
      lastRun: recent[0] ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "ALCHEMIST_SUMMARY_ERROR", message });
  }
});

export default router;
