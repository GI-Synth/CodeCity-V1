import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db/schema";
import { and, desc, eq, like, or } from "drizzle-orm";

const router: IRouter = Router();
let cleanedLegacySyntheticEvents = false;

async function purgeLegacySyntheticEvents(): Promise<void> {
  if (cleanedLegacySyntheticEvents) return;

  await db.delete(eventsTable).where(
    or(
      like(eventsTable.id, "evt-seed-%"),
      like(eventsTable.id, "evt-live-%"),
      eq(eventsTable.type, "task_complete"),
      and(eq(eventsTable.type, "escalation"), like(eventsTable.message, "%offered escalation%")),
      and(eq(eventsTable.type, "bug_found"), like(eventsTable.message, "%found%bug(s)%")),
    )
  );

  cleanedLegacySyntheticEvents = true;
}

router.get("/stream", async (_req, res) => {
  try {
    await purgeLegacySyntheticEvents();

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
