import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reposTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { generateDemoRepo } from "../lib/githubFetcher";
import { buildCityLayout } from "../lib/cityAnalyzer";
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
    const avgCoverage = buildings.reduce((s, b) => s + b.testCoverage, 0) / (buildings.length || 1);
    const cleanRatio = buildings.filter(b => b.status === "healthy" || b.status === "glowing").length / (buildings.length || 1);
    const avgComplexity = buildings.reduce((s, b) => s + b.complexity, 0) / (buildings.length || 1);

    res.json({
      score: layout.healthScore,
      season: layout.season,
      testCoverageRatio: avgCoverage,
      cleanBuildingRatio: cleanRatio,
      avgComplexity,
      commitFrequency: 0.7,
      breakdown: {
        testCoverage: avgCoverage * 40,
        codeQuality: cleanRatio * 30,
        complexity: Math.max(0, (20 - avgComplexity) / 20) * 20,
        activity: 10,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "HEALTH_ERROR", message });
  }
});

router.get("/metrics", (_req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    cpuUsage: Math.random() * 40 + 10,
    memoryUsage: Math.random() * 30 + 30,
    activeAgents: Math.floor(Math.random() * 8) + 2,
    bugsFound: Math.floor(Math.random() * 5),
    testsRun: Math.floor(Math.random() * 20) + 5,
    escalations: Math.floor(Math.random() * 2),
    knowledgeBaseHits: Math.floor(Math.random() * 8) + 2,
  });
});

export default router;
