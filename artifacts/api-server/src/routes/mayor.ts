/**
 * Mayor routes — REST API for strategic mode and Mayor intelligence.
 */

import { Router } from "express";
import { orchestrator } from "../lib/orchestrator";
import type { MayorStrategicMode } from "../lib/orchestrator";

const router = Router();

const VALID_MODES = new Set<MayorStrategicMode>(["triage", "improvement", "security", "architecture", "learning"]);

/** GET /api/mayor/status — current strategic mode + last directive + recommendations */
router.get("/status", (_req, res) => {
  res.json({
    ok: true,
    strategicMode: orchestrator.getStrategicMode(),
    model: orchestrator.getModel(),
    lastDirective: orchestrator.getLastDirective(),
    nextRunInMs: orchestrator.getNextRunIn(),
    recommendations: orchestrator.getLastRecommendations(),
  });
});

/** POST /api/mayor/mode — set the strategic mode manually */
router.post("/mode", (req, res) => {
  const { mode } = req.body as { mode?: string };
  if (!mode || !VALID_MODES.has(mode as MayorStrategicMode)) {
    res.status(400).json({ ok: false, error: `Invalid mode. Valid: ${[...VALID_MODES].join(", ")}` });
    return;
  }
  orchestrator.setStrategicMode(mode as MayorStrategicMode);
  res.json({ ok: true, mode });
});

export default router;
