import { Router } from "express";
import { db } from "@workspace/db";
import { reposTable, agentsTable, eventsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

const router = Router();

router.post("/report", async (_req, res) => {
  try {
    const repos = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
    const agents = await db.select().from(agentsTable);
    const events = await db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(20);

    const repo = repos[0];
    const repoName = repo?.repoName ?? "Unknown Repository";
    const now = new Date().toISOString();

    const totalBugs = agents.reduce((s, a) => s + a.bugsFound, 0);
    const totalTests = agents.reduce((s, a) => s + a.testsGenerated, 0);
    const totalEscalations = agents.reduce((s, a) => s + a.escalationCount, 0);
    const totalTasks = agents.reduce((s, a) => s + a.totalTasksCompleted, 0);

    const agentTable = agents
      .sort((a, b) => b.bugsFound - a.bugsFound)
      .map(a =>
        `| ${a.name} | ${a.role} | Lv.${a.level} ${a.rank} | ${a.bugsFound} | ${a.testsGenerated} | ${(a.accuracy * 100).toFixed(0)}% |`
      ).join("\n");

    const recentEvents = events
      .map(e => `- \`${e.timestamp?.slice(0, 19) ?? "—"}\` **${e.type}** — ${e.message}`)
      .join("\n");

    const layoutData = repo?.layoutData ? JSON.parse(repo.layoutData) : null;
    const districts: string = layoutData?.districts
      ? layoutData.districts.map((d: { name: string; buildings?: unknown[] }) => `- **${d.name}** (${d.buildings?.length ?? 0} buildings)`).join("\n")
      : "_No districts loaded_";

    const report = `# Software City Report — ${repoName}

> Generated: ${now}

## Summary

| Metric | Value |
|--------|-------|
| Repository | ${repoName} |
| Active Agents | ${agents.length} |
| Bugs Found | ${totalBugs} |
| Tests Generated | ${totalTests} |
| Tasks Completed | ${totalTasks} |
| Escalations | ${totalEscalations} |

## City Districts

${districts}

## Agent Roster

| Name | Role | Level/Rank | Bugs | Tests | Accuracy |
|------|------|-----------|------|-------|---------|
${agentTable}

## Recent Events

${recentEvents || "_No recent events_"}

---
_Software City — AI-powered code quality visualization_
`;

    res.json({ report });
  } catch (err) {
    console.error("[Report] Failed to generate report:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
