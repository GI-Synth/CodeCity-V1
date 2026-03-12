import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reposTable, agentsTable, eventsTable } from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { generateDemoRepo } from "../lib/githubFetcher";
import { buildCityLayout } from "../lib/cityAnalyzer";
import { computeHealthScore } from "../lib/healthScorer";
import type { CityLayout } from "../lib/types";

const router: IRouter = Router();

async function getActiveLayout(): Promise<{ layout: CityLayout; repoName: string }> {
  const activeRepos = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
  const repo = activeRepos.length > 0 ? activeRepos[0]
    : (await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1))[0];

  if (repo?.layoutData) {
    return { layout: JSON.parse(repo.layoutData) as CityLayout, repoName: repo.repoName };
  }

  const { files, repoName } = generateDemoRepo();
  return { layout: buildCityLayout(files, repoName), repoName };
}

router.get("/layout", async (_req, res) => {
  try {
    const { layout } = await getActiveLayout();
    res.json(layout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "LAYOUT_ERROR", message });
  }
});

router.get("/health", async (_req, res) => {
  try {
    const { layout } = await getActiveLayout();
    const buildings = layout.districts.flatMap(d => d.buildings);
    const { score, season } = computeHealthScore(buildings);

    const avgCoverage = buildings.reduce((s, b) => s + b.testCoverage, 0) / (buildings.length || 1);
    const cleanRatio = buildings.filter(b => b.status === "healthy" || b.status === "glowing").length / (buildings.length || 1);
    const avgComplexity = buildings.reduce((s, b) => s + b.complexity, 0) / (buildings.length || 1);
    const testFileRatio = buildings.filter(b => b.fileType === "test").length / (buildings.length || 1);

    res.json({
      score, season, testCoverageRatio: avgCoverage, cleanBuildingRatio: cleanRatio,
      avgComplexity, testFileRatio, commitFrequency: 0.7,
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
      activeAgents, bugsFound, testsRun, escalations,
      knowledgeBaseHits: Math.floor(Math.random() * 8) + 2,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "METRICS_ERROR", message });
  }
});

router.get("/snapshot", async (_req, res) => {
  try {
    const { layout } = await getActiveLayout();
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

router.get("/diff", async (req, res) => {
  try {
    const { from, to, path: filePath } = req.query;
    if (!from || !to) {
      res.status(400).json({ error: "MISSING_PARAMS", message: "from and to commit hashes required" });
      return;
    }

    const { simpleGit } = await import("simple-git");
    const git = simpleGit(process.cwd());

    const args = [String(from), String(to), "--stat"];
    if (filePath) args.push("--", String(filePath));

    const stat = await git.raw(["diff", ...args]).catch(() => "");
    const rawArgs = [String(from), String(to)];
    if (filePath) rawArgs.push("--", String(filePath));

    const rawDiff = await git.raw(["diff", ...rawArgs]).catch(() => "");

    const addMatch = stat.match(/(\d+) insertion/);
    const delMatch = stat.match(/(\d+) deletion/);

    res.json({
      rawDiff: rawDiff.slice(0, 50000),
      stats: {
        additions: addMatch ? parseInt(addMatch[1]) : 0,
        deletions: delMatch ? parseInt(delMatch[1]) : 0,
        files: stat.split("\n").filter(l => l.includes("|")).length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "DIFF_ERROR", message });
  }
});

router.get("/commit/:hash", async (req, res) => {
  try {
    const { hash } = req.params;
    const { simpleGit } = await import("simple-git");
    const git = simpleGit(process.cwd());

    const log = await git.show([hash, "--stat", "--format=%H%n%an%n%ad%n%s"]).catch(() => "");
    const lines = log.split("\n");

    const changedFiles: Array<{ path: string; additions: number; deletions: number; status: string }> = [];
    for (const line of lines) {
      const m = line.match(/^\s*(.+)\s+\|\s+(\d+)\s+([+\-]+)/);
      if (m) {
        const additions = (m[3].match(/\+/g) ?? []).length;
        const deletions = (m[3].match(/-/g) ?? []).length;
        changedFiles.push({ path: m[1].trim(), additions, deletions, status: "modified" });
      }
    }

    res.json({
      hash: lines[0] ?? hash,
      author: lines[1] ?? "Unknown",
      date: lines[2] ?? new Date().toISOString(),
      message: lines[3] ?? "No message",
      changedFiles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "COMMIT_ERROR", message });
  }
});

router.post("/at-commit", async (req, res): Promise<void> => {
  try {
    const { commitHash } = req.body;
    if (!commitHash) {
      res.status(400).json({ error: "MISSING_HASH", message: "commitHash required" });
      return;
    }

    const { simpleGit } = await import("simple-git");
    const git = simpleGit(process.cwd());

    const files: Array<{ path: string; name: string; content: string; linesOfCode: number; language: string; folder: string }> = [];
    try {
      const fileList = await git.raw(["ls-tree", "-r", "--name-only", String(commitHash)]);
      const paths = fileList.split("\n").filter(Boolean).slice(0, 200);
      for (const p of paths) {
        const content = await git.raw(["show", `${commitHash}:${p}`]).catch(() => "");
        const parts = p.split("/");
        files.push({
          path: p,
          name: parts[parts.length - 1] ?? p,
          content: content.slice(0, 5000),
          linesOfCode: content.split("\n").length,
          language: p.endsWith(".ts") ? "typescript" : p.endsWith(".js") ? "javascript" : p.endsWith(".py") ? "python" : "text",
          folder: parts.slice(0, -1).join("/") || "root",
        });
      }
    } catch { }

    if (files.length === 0) {
      const { layout } = await getActiveLayout();
      res.json(layout);
      return;
    }

    const layout = buildCityLayout(files, `commit:${String(commitHash).slice(0, 7)}`);
    res.json(layout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "AT_COMMIT_ERROR", message });
  }
});

export default router;
