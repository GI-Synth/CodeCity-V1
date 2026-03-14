import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { metricSnapshotsTable, agentsTable } from "@workspace/db/schema";
import { desc, gte, count, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/history", async (req, res) => {
  try {
    const hoursParam = typeof req.query["hours"] === "string" ? parseInt(req.query["hours"]) : 24;
    const hours = Math.min(168, Math.max(1, isNaN(hoursParam) ? 24 : hoursParam));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const snapshots = await db
      .select()
      .from(metricSnapshotsTable)
      .where(gte(metricSnapshotsTable.timestamp, since))
      .orderBy(desc(metricSnapshotsTable.timestamp))
      .limit(1000);

    res.json({
      snapshots: snapshots.reverse(),
      hours,
      count: snapshots.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "METRICS_HISTORY_ERROR", message });
  }
});

export async function writeMetricSnapshot() {
  try {
    type AgentRow = { status: string; bugsFound: number; escalations: number; testsGenerated: number; kbHits?: number };
    const agents: AgentRow[] = await db.select().from(agentsTable).catch(() => [] as AgentRow[]);
    const activeAgents = agents.filter(a => a.status === "working").length;
    const pausedAgents = agents.filter(a => (a.status as string) === "paused").length;
    const totalBugs = agents.reduce((s, a) => s + a.bugsFound, 0);
    const totalEscalations = agents.reduce((s, a) => s + a.escalations, 0);
    const totalTasks = agents.reduce((s, a) => s + a.testsGenerated, 0);
    const totalKbHits = agents.reduce((s, a) => s + (a.kbHits ?? 0), 0);

    const cpuUsage = (process.cpuUsage().user / 1000000) % 100;
    const memMb = process.memoryUsage().heapUsed / 1024 / 1024;

    await db.insert(metricSnapshotsTable).values({
      healthScore: 75,
      coverageOverall: 0.65,
      activeAgents,
      pausedAgents,
      totalBugs,
      kbHitRate: totalTasks > 0 ? Math.min(1, totalKbHits / totalTasks) : 0,
      tasksCompleted: totalTasks,
      escalationsToday: totalEscalations,
      cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
      memoryMb: memMb,
    });

    const [countRow] = await db.select({ total: count() }).from(metricSnapshotsTable);
    if ((countRow?.total ?? 0) > 1000) {
      const oldOnes = await db.select({ id: metricSnapshotsTable.id })
        .from(metricSnapshotsTable)
        .orderBy(metricSnapshotsTable.timestamp)
        .limit(100);
      for (const old of oldOnes) {
        await db.delete(metricSnapshotsTable).where(sql`id = ${old.id}`);
      }
    }
  } catch { }
}

export default router;
