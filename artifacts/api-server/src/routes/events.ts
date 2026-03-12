import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

const EVENT_TYPES = [
  "fire", "bug_found", "test_passed", "escalation",
  "knowledge_hit", "building_collapse", "season_change", "agent_promoted"
] as const;

const SEVERITIES = ["info", "warning", "error", "critical"] as const;

const SAMPLE_EVENTS = [
  { type: "fire", buildingName: "userController.ts", message: "🔥 Fire detected in userController.ts — high CPU usage", severity: "error" },
  { type: "bug_found", buildingName: "authController.ts", message: "🐛 Inspector Rex found 2 bugs in authController.ts", severity: "warning" },
  { type: "test_passed", buildingName: "utils.test.ts", message: "✅ 12 tests passed in utils.test.ts — coverage 87%", severity: "info" },
  { type: "escalation", buildingName: "orderController.ts", message: "📡 API Breaker escalated to Claude AI — complex race condition", severity: "info" },
  { type: "knowledge_hit", buildingName: "schema.ts", message: "🧠 Knowledge base hit! Saved 1 escalation on SQL injection pattern", severity: "info" },
  { type: "season_change", buildingName: null, message: "🌿 City season shifted to SPRING — health score improved to 65%", severity: "info" },
  { type: "building_collapse", buildingName: "legacy.js", message: "💥 Building collapse detected: legacy.js has 0% test coverage", severity: "critical" },
  { type: "agent_promoted", buildingName: null, message: "⭐ QA Quinn promoted to Level 3 — 94% accuracy over 50 tests", severity: "info" },
];

async function seedEvents() {
  const existing = await db.select().from(eventsTable).limit(1);
  if (existing.length > 0) return;

  for (let i = 0; i < SAMPLE_EVENTS.length; i++) {
    const sample = SAMPLE_EVENTS[i];
    await db.insert(eventsTable).values({
      id: `evt-seed-${i}`,
      type: sample.type,
      buildingName: sample.buildingName ?? null,
      message: sample.message,
      severity: sample.severity,
    });
  }
}

router.get("/stream", async (_req, res) => {
  try {
    await seedEvents();

    // Occasionally add a new random event
    if (Math.random() < 0.3) {
      const sample = SAMPLE_EVENTS[Math.floor(Math.random() * SAMPLE_EVENTS.length)];
      await db.insert(eventsTable).values({
        id: `evt-live-${Date.now()}`,
        type: sample.type,
        buildingName: sample.buildingName ?? null,
        message: sample.message,
        severity: sample.severity,
      });
    }

    const events = await db
      .select()
      .from(eventsTable)
      .orderBy(desc(eventsTable.timestamp))
      .limit(50);

    res.json({
      events: events.map(e => ({
        id: e.id,
        type: e.type,
        buildingId: e.buildingId ?? null,
        buildingName: e.buildingName ?? null,
        agentId: e.agentId ?? null,
        agentName: e.agentName ?? null,
        message: e.message,
        severity: e.severity,
        timestamp: e.timestamp ?? new Date().toISOString(),
      })),
      total: events.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "EVENTS_ERROR", message });
  }
});

export default router;
