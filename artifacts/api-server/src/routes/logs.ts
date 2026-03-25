/**
 * Console Log routes — REST API for the Console Log Agent.
 */

import { Router } from "express";
import {
  getRecentLogs,
  getErrorHotspots,
  getConsoleLogStats,
  ingestLog,
  type LogLevel,
} from "../lib/consoleLogAgent";

const router = Router();

/** GET /api/logs/recent?limit=50&level=error — recent log entries */
router.get("/recent", async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const level = req.query.level as LogLevel | undefined;
  const validLevels = new Set(["error", "warn", "perf", "info"]);
  const logs = await getRecentLogs(limit, validLevels.has(level as string) ? level : undefined);
  res.json({ ok: true, logs });
});

/** GET /api/logs/hotspots?windowMinutes=60&limit=20 — error frequency by file */
router.get("/hotspots", async (req, res) => {
  const windowMinutes = Math.min(1440, Math.max(1, Number(req.query.windowMinutes) || 60));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const hotspots = await getErrorHotspots(windowMinutes, limit);
  res.json({ ok: true, hotspots });
});

/** GET /api/logs/stats — console log agent statistics */
router.get("/stats", (_req, res) => {
  res.json({ ok: true, stats: getConsoleLogStats() });
});

/** POST /api/logs/ingest — manually ingest a log string (for testing or external feed) */
router.post("/ingest", (req, res) => {
  const { raw } = req.body as { raw?: string };
  if (!raw || typeof raw !== "string") {
    res.status(400).json({ ok: false, error: "raw string is required" });
    return;
  }
  ingestLog(raw.slice(0, 10_000)); // cap at 10KB per ingestion
  res.json({ ok: true });
});

export default router;
