import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reposTable } from "@workspace/db/schema";
import { fetchGithubRepo, generateDemoRepo } from "../lib/githubFetcher";
import { buildCityLayout } from "../lib/cityAnalyzer";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.post("/load", async (req, res): Promise<void> => {
  const { repoUrl, branch = "main", githubToken } = req.body;

  if (!repoUrl || typeof repoUrl !== "string") {
    res.status(400).json({ error: "INVALID_URL", message: "repoUrl is required" });
    return;
  }

  const startTime = Date.now();
  try {
    const { files, repoName } = await fetchGithubRepo(repoUrl, branch, githubToken || undefined);
    const layout = buildCityLayout(files, repoName);
    const analysisTime = (Date.now() - startTime) / 1000;

    await db.insert(reposTable).values({
      repoUrl,
      repoName,
      branch,
      fileCount: files.length,
      districtCount: layout.districts.length,
      healthScore: layout.healthScore,
      season: layout.season,
      layoutData: JSON.stringify(layout),
      analysisTime,
    });

    res.json({
      success: true,
      repoName,
      fileCount: files.length,
      districtCount: layout.districts.length,
      analysisTime,
      message: `Successfully loaded ${repoName} — ${files.length} files analyzed`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: "LOAD_FAILED", message });
  }
});

router.post("/demo", async (_req, res) => {
  const startTime = Date.now();
  try {
    const { files, repoName } = generateDemoRepo();
    const layout = buildCityLayout(files, repoName);
    const analysisTime = (Date.now() - startTime) / 1000;

    const existing = await db.select().from(reposTable).where(
      // @ts-ignore
      undefined
    ).orderBy(desc(reposTable.createdAt)).limit(1);

    if (!existing.find(r => r.repoUrl === "demo://software-city-example")) {
      await db.insert(reposTable).values({
        repoUrl: "demo://software-city-example",
        repoName,
        branch: "main",
        fileCount: files.length,
        districtCount: layout.districts.length,
        healthScore: layout.healthScore,
        season: layout.season,
        layoutData: JSON.stringify(layout),
        analysisTime,
      });
    }

    res.json({
      success: true,
      repoName,
      fileCount: files.length,
      districtCount: layout.districts.length,
      analysisTime,
      message: `Demo city loaded — ${files.length} files in ${layout.districts.length} districts`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: "DEMO_FAILED", message });
  }
});

export default router;
