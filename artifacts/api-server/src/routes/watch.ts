import { Router, type IRouter } from "express";
import { fileWatcher } from "../lib/fileWatcher";
import { db } from "@workspace/db";
import { reposTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { buildCityLayout } from "../lib/cityAnalyzer";
import type { CityLayout, Building } from "../lib/types";

const router: IRouter = Router();

async function getCurrentBuildings(): Promise<Building[]> {
  try {
    const repos = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
    if (repos.length === 0 || !repos[0].layoutData) return [];
    const layout = JSON.parse(repos[0].layoutData) as CityLayout;
    return layout.districts.flatMap(d => d.buildings);
  } catch {
    return [];
  }
}

router.post("/", async (req, res): Promise<void> => {
  try {
    const { localPath } = req.body;
    if (!localPath || typeof localPath !== "string") {
      res.status(400).json({ error: "INVALID_PATH", message: "localPath is required" });
      return;
    }

    const buildings = await getCurrentBuildings();
    fileWatcher.start(localPath, buildings);

    res.json({ watching: true, path: localPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "WATCH_ERROR", message });
  }
});

router.get("/status", (_req, res) => {
  res.json({
    watching: fileWatcher.isWatching(),
    path: fileWatcher.getWatchedPath(),
  });
});

router.delete("/", (_req, res) => {
  fileWatcher.stop();
  res.json({ watching: false });
});

export default router;
