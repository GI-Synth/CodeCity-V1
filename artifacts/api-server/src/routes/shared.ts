import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { snapshotsTable, reposTable, agentsTable, eventsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { computeHealthScore } from "../lib/healthScorer";
import type { CityLayout } from "../lib/types";

const router: IRouter = Router();

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

router.post("/share", async (_req, res): Promise<void> => {
  try {
    const repos = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
    if (repos.length === 0) {
      res.status(404).json({ error: "NO_REPO", message: "No repository loaded" });
      return;
    }
    const repo = repos[0];
    const layout = repo.layoutData ? JSON.parse(repo.layoutData) as CityLayout : null;
    const buildings = layout?.districts?.flatMap(d => d.buildings) ?? [];
    const { score, season } = computeHealthScore(buildings);
    type AgentRow = { bugsFound: number };
    const agents: AgentRow[] = await db.select().from(agentsTable).catch(() => [] as AgentRow[]);

    const token = randomToken();
    const snapshotData = JSON.stringify({
      layout,
      healthScore: score,
      season,
      agentCount: agents.length,
      bugsFound: agents.reduce((s, a) => s + a.bugsFound, 0),
      repoName: repo.repoName,
      repoSlug: repo.slug ?? String(repo.id),
      sharedAt: new Date().toISOString(),
    });

    await db.insert(snapshotsTable).values({
      token,
      repoSlug: repo.slug ?? String(repo.id),
      repoName: repo.repoName,
      snapshotData,
    });

    res.json({ url: `/shared/${token}`, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SHARE_ERROR", message });
  }
});

router.get("/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  try {
    const snaps = await db.select().from(snapshotsTable).where(eq(snapshotsTable.token, token));
    if (snaps.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Snapshot not found" });
      return;
    }
    const snap = snaps[0];
    await db.update(snapshotsTable).set({ viewCount: snap.viewCount + 1 }).where(eq(snapshotsTable.id, snap.id));
    const data = JSON.parse(snap.snapshotData);
    res.json({ ...data, viewCount: snap.viewCount + 1, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SNAPSHOT_ERROR", message });
  }
});

export default router;
