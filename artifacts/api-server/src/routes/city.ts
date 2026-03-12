import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reposTable, agentsTable, eventsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { generateDemoRepo } from "../lib/githubFetcher";
import { buildCityLayout } from "../lib/cityAnalyzer";
import { computeHealthScore } from "../lib/healthScorer";
import type { CityLayout } from "../lib/types";

const router: IRouter = Router();

async function getLatestLayout(): Promise<CityLayout> {
  const repos = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
  if (repos.length === 0 || !repos[0].layoutData) {
    const { files, repoName } = generateDemoRepo();
    return buildCityLayout(files, repoName);
  }
  return JSON.parse(repos[0].layoutData) as CityLayout;
}

router.get("/layout", async (_req, res) => {
  try {
    const layout = await getLatestLayout();
    res.json(layout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "LAYOUT_ERROR", message });
  }
});

router.get("/health", async (_req, res) => {
  try {
    const layout = await getLatestLayout();
    const buildings = layout.districts.flatMap(d => d.buildings);
    const { score, season } = computeHealthScore(buildings);

    const avgCoverage = buildings.reduce((s, b) => s + b.testCoverage, 0) / (buildings.length || 1);
    const cleanRatio = buildings.filter(b => b.status === "healthy" || b.status === "glowing").length / (buildings.length || 1);
    const avgComplexity = buildings.reduce((s, b) => s + b.complexity, 0) / (buildings.length || 1);
    const testFileRatio = buildings.filter(b => b.fileType === "test").length / (buildings.length || 1);

    res.json({
      score,
      season,
      testCoverageRatio: avgCoverage,
      cleanBuildingRatio: cleanRatio,
      avgComplexity,
      testFileRatio,
      commitFrequency: 0.7,
      breakdown: {
        testCoverage: avgCoverage * 40,
        codeQuality: cleanRatio * 30,
        complexity: Math.max(0, 1 - avgComplexity / 30) * 20,
        testFileRatio: testFileRatio * 10,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "HEALTH_ERROR", message });
  }
});

router.get("/metrics", async (_req, res) => {
  try {
    type AgentRow = { status: string; bugsFound: number; escalations: number; testsGenerated: number };
    const agents: AgentRow[] = await db.select().from(agentsTable).catch(() => [] as AgentRow[]);
    const activeAgents = agents.filter((a: AgentRow) => a.status === "working").length || agents.length;
    const bugsFound = agents.reduce((s: number, a: AgentRow) => s + a.bugsFound, 0);
    const escalations = agents.reduce((s: number, a: AgentRow) => s + a.escalations, 0);
    const testsRun = agents.reduce((s: number, a: AgentRow) => s + a.testsGenerated, 0);

    res.json({
      timestamp: new Date().toISOString(),
      cpuUsage: process.cpuUsage().user / 1000000 % 100 || Math.random() * 30 + 5,
      memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024),
      activeAgents,
      bugsFound,
      testsRun,
      escalations,
      knowledgeBaseHits: Math.floor(Math.random() * 8) + 2,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "METRICS_ERROR", message });
  }
});

router.get("/snapshot", async (_req, res) => {
  try {
    const layout = await getLatestLayout();
    const buildings = layout.districts.flatMap(d => d.buildings);
    const { score, season } = computeHealthScore(buildings);
    const agents = await db.select().from(agentsTable).catch(() => []);
    const events = await db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(50).catch(() => []);

    const snapshot = {
      exportedAt: new Date().toISOString(),
      districts: layout.districts,
      buildings,
      roads: layout.roads,
      repoName: layout.repoName,
      totalFiles: layout.totalFiles,
      healthScore: score,
      season,
      agents,
      events,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="software-city-snapshot-${Date.now()}.json"`);
    res.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SNAPSHOT_ERROR", message });
  }
});

export default router;
