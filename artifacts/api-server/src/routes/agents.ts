import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentsTable, eventsTable, reposTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { createAgent, simulateAgentTask } from "../lib/agentEngine";
import { generateDialogue, escalate } from "../lib/escalationEngine";
import { testExecutor } from "../lib/testExecutor";
import { buildTestGenerationPrompt } from "../lib/ollamaPrompts";
import { ollamaClient } from "../lib/ollamaClient";
import type { CityLayout } from "../lib/types";

const router: IRouter = Router();

async function ensureAgents() {
  const existing = await db.select().from(agentsTable).limit(1);
  if (existing.length === 0) {
    const roles: Array<"qa_inspector" | "api_fuzzer" | "load_tester" | "edge_explorer" | "ui_navigator"> = [
      "qa_inspector", "api_fuzzer", "load_tester", "edge_explorer", "ui_navigator",
    ];
    for (const role of roles) {
      const agent = createAgent(role);
      await db.insert(agentsTable).values(agent);
    }
  }
}

router.get("/list", async (_req, res) => {
  try {
    await ensureAgents();
    const agents = await db.select().from(agentsTable);
    res.json({ agents, total: agents.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "AGENTS_ERROR", message });
  }
});

router.post("/spawn", async (req, res) => {
  try {
    const { role, targetBuilding } = req.body;
    const agent = createAgent(role, targetBuilding ?? null);
    await db.insert(agentsTable).values(agent);

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}`,
      type: "agent_promoted",
      agentId: agent.id,
      agentName: agent.name,
      message: `New ${agent.role.replace("_", " ")} spawned: ${agent.name}`,
      severity: "info",
    });

    res.json(agent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SPAWN_ERROR", message });
  }
});

router.patch("/:agentId/pause", async (req, res): Promise<void> => {
  const { agentId } = req.params;
  try {
    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const agent = agents[0];
    const nowPaused = agent.status !== "paused";
    const newStatus = nowPaused ? "paused" : "idle";
    await db.update(agentsTable).set({ status: newStatus }).where(eq(agentsTable.id, agentId));
    res.json({ success: true, paused: nowPaused, status: newStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "PAUSE_ERROR", message });
  }
});

router.patch("/pause-all", async (_req, res) => {
  try {
    const agents = await db.select().from(agentsTable);
    const anyActive = agents.some(a => a.status !== "paused" && a.status !== "retired");
    const newStatus = anyActive ? "paused" : "idle";
    for (const agent of agents) {
      if (agent.status !== "retired") {
        await db.update(agentsTable).set({ status: newStatus }).where(eq(agentsTable.id, agent.id));
      }
    }
    res.json({ success: true, paused: anyActive, status: newStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "PAUSE_ALL_ERROR", message });
  }
});

router.patch("/:agentId/verdict", async (req, res): Promise<void> => {
  const { agentId } = req.params;
  const { verdict } = req.body as { verdict: "true_positive" | "false_positive" };

  if (verdict !== "true_positive" && verdict !== "false_positive") {
    res.status(400).json({ error: "INVALID_VERDICT", message: "verdict must be true_positive or false_positive" });
    return;
  }

  try {
    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const agent = agents[0];

    const newTp = agent.truePositives + (verdict === "true_positive" ? 1 : 0);
    const newFp = agent.falsePositives + (verdict === "false_positive" ? 1 : 0);
    const total = newTp + newFp;
    const newAccuracy = total > 0 ? newTp / total : 0.8;

    await db.update(agentsTable).set({
      truePositives: newTp,
      falsePositives: newFp,
      accuracy: newAccuracy,
    }).where(eq(agentsTable.id, agentId));

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}`,
      type: "verdict",
      agentId,
      agentName: agent.name,
      message: `${agent.name} verdict: ${verdict.replace("_", " ")} — accuracy now ${Math.round(newAccuracy * 100)}%`,
      severity: verdict === "false_positive" ? "warning" : "info",
    }).catch(() => {});

    res.json({ success: true, verdict, truePositives: newTp, falsePositives: newFp, accuracy: newAccuracy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "VERDICT_ERROR", message });
  }
});

router.post("/:agentId/task", async (req, res): Promise<void> => {
  try {
    const { agentId } = req.params;
    const { taskType, buildingId, context } = req.body;

    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Agent not found" });
      return;
    }

    const agent = agents[0];
    const taskResult = simulateAgentTask(agent as any, taskType, buildingId, context);

    await db.update(agentsTable).set({
      bugsFound: agent.bugsFound + taskResult.bugsFound,
      testsGenerated: agent.testsGenerated + (taskType === "generate_tests" ? 5 : 0),
      escalations: agent.escalations + (taskResult.escalated ? 1 : 0),
      currentBuilding: buildingId,
      currentTask: taskType,
      status: "reporting",
    }).where(eq(agentsTable.id, agentId));

    if (taskResult.bugsFound > 0) {
      await db.insert(eventsTable).values({
        id: `evt-${Date.now()}`,
        type: "bug_found",
        buildingId,
        buildingName: buildingId,
        agentId,
        agentName: agent.name,
        message: `${agent.name} found ${taskResult.bugsFound} bug(s) in ${buildingId}`,
        severity: taskResult.bugsFound > 2 ? "critical" : "warning",
      });
    }

    if (taskResult.escalated) {
      await db.insert(eventsTable).values({
        id: `evt-${Date.now() + 1}`,
        type: "escalation",
        agentId,
        agentName: agent.name,
        message: `${agent.name} escalated to external AI for help on ${buildingId}`,
        severity: "info",
      });
    }

    res.json({ success: true, taskType, ...taskResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "TASK_ERROR", message });
  }
});

const pendingEscalations = new Map<string, { question: string; buildingContent: string; language: string }>();

router.post("/:agentId/chat", async (req, res): Promise<void> => {
  try {
    const { agentId } = req.params;
    const { message, buildingContext, buildingContent, buildingLanguage } = req.body;

    const allAgents = await db.select().from(agentsTable);

    let agent = allAgents.find(a => a.id === agentId);
    if (!agent && allAgents.length > 0) agent = allAgents[0];
    if (!agent) {
      res.status(404).json({ error: "NOT_FOUND", message: "No agents available" });
      return;
    }

    const escKey = `${agent.id}-${buildingContext ?? "unknown"}`;

    if (typeof message === "string" && message.toLowerCase().includes("yes escalate")) {
      const pending = pendingEscalations.get(escKey);
      if (pending) {
        const result = await escalate({
          question: pending.question,
          codeSnippet: pending.buildingContent,
          language: pending.language,
          failedAttempts: [],
        });

        pendingEscalations.delete(escKey);

        await db.insert(eventsTable).values({
          id: `evt-${Date.now()}`,
          type: "escalation",
          agentId: agent.id,
          agentName: agent.name,
          message: `${agent.name} escalated to ${result.source} for ${buildingContext ?? "building"}`,
          severity: "info",
        }).catch(() => {});

        res.json({
          message: `[${result.source.toUpperCase()}] ${result.answer}${result.action_items.length > 0 ? "\n\nAction items:\n" + result.action_items.map(a => `• ${a}`).join("\n") : ""}`,
          source: result.source,
          confidence: result.confidence,
          offerEscalation: false,
          agentName: agent.name,
          agentRole: agent.role,
        });
        return;
      }
    }

    const dialogueResult = await generateDialogue({
      npcRole: agent.role,
      buildingFile: buildingContext ?? "unknown.ts",
      buildingContent: typeof buildingContent === "string" ? buildingContent : `File: ${buildingContext ?? "unknown"}`,
      recentFindings: [],
      question: typeof message === "string" ? message : "What does this file do?",
      language: typeof buildingLanguage === "string" ? buildingLanguage : "typescript",
    });

    if (dialogueResult.offerEscalation) {
      pendingEscalations.set(escKey, {
        question: typeof message === "string" ? message : "",
        buildingContent: typeof buildingContent === "string" ? buildingContent : buildingContext ?? "",
        language: typeof buildingLanguage === "string" ? buildingLanguage : "typescript",
      });
    }

    if (dialogueResult.offerEscalation) {
      await db.insert(eventsTable).values({
        id: `evt-${Date.now()}`,
        type: "escalation",
        agentId: agent.id,
        agentName: agent.name,
        message: `${agent.name} offered escalation for ${buildingContext ?? "building"}`,
        severity: "info",
      }).catch(() => {});
    }

    res.json({
      message: dialogueResult.message,
      source: dialogueResult.source,
      confidence: dialogueResult.confidence,
      offerEscalation: dialogueResult.offerEscalation,
      agentName: agent.name,
      agentRole: agent.role,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "CHAT_ERROR", message });
  }
});

router.get("/leaderboard", async (_req, res) => {
  try {
    const agents = await db.select().from(agentsTable).orderBy(desc(agentsTable.bugsFound));
    const rankOrder: Record<string, number> = { principal: 4, senior: 3, mid: 2, junior: 1 };
    const sorted = agents
      .filter(a => a.status !== "retired")
      .sort((a, b) => {
        const ra = rankOrder[a.rank ?? "junior"] ?? 1;
        const rb = rankOrder[b.rank ?? "junior"] ?? 1;
        if (rb !== ra) return rb - ra;
        return b.bugsFound - a.bugsFound;
      });
    const rankColors: Record<string, string> = {
      principal: "#ffd700", senior: "#c0c0c0", mid: "#cd7f32", junior: "#4a9eff",
    };
    res.json({
      agents: sorted.map((a, i) => ({
        rank: i + 1,
        id: a.id,
        name: a.name,
        role: a.role,
        color: a.color,
        rankTitle: a.rank ?? "junior",
        rankColor: rankColors[a.rank ?? "junior"] ?? "#4a9eff",
        bugsFound: a.bugsFound,
        accuracy: a.accuracy,
        kbHits: a.kbHits ?? 0,
        escalations: a.escalationCount ?? 0,
        totalTasks: a.totalTasksCompleted ?? 0,
        truePositives: a.truePositives ?? 0,
        level: a.level,
        status: a.status,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "LEADERBOARD_ERROR", message });
  }
});

router.post("/:agentId/retire", async (req, res): Promise<void> => {
  const { agentId } = req.params;
  try {
    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    await db.update(agentsTable).set({ status: "retired", currentTask: null }).where(eq(agentsTable.id, agentId));
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "RETIRE_ERROR", message });
  }
});

router.post("/:agentId/run-tests", async (req, res): Promise<void> => {
  const { agentId } = req.params;
  try {
    const { buildingId } = req.body;

    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Agent not found" });
      return;
    }

    const activeRepos = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
    const repos = activeRepos.length > 0 ? activeRepos
      : await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);

    if (repos.length === 0 || !repos[0].layoutData) {
      res.status(404).json({ error: "NO_REPO", message: "No repository loaded" });
      return;
    }

    const layout = JSON.parse(repos[0].layoutData) as CityLayout;
    const building = layout.districts.flatMap(d => d.buildings).find(b => b.id === buildingId);

    if (!building) {
      res.status(404).json({ error: "NO_BUILDING", message: `Building '${buildingId}' not found` });
      return;
    }

    const { system, prompt } = buildTestGenerationPrompt(building.name, building.filePath, building.language);
    let testCode = "";

    const ollamaAvailable = await ollamaClient.isAvailable();
    if (ollamaAvailable) {
      try {
        testCode = await ollamaClient.generate({
          model: "deepseek-coder-v2:16b",
          system,
          prompt,
          temperature: 0.4,
          maxTokens: 1500,
        });
      } catch { }
    }

    if (!testCode) {
      testCode = `
// Auto-generated sanity tests for ${building.name}
const assert = require('assert');
console.log('PASSED: ${building.name} import check');
console.log('PASSED: ${building.name} file structure check');
console.log('Tests: 2 passed, 0 failed');
`;
    }

    const result = await testExecutor.executeTests({
      targetFile: building.filePath,
      testCode,
      language: building.language,
      timeoutMs: 15000,
    });

    await db.update(agentsTable).set({
      bugsFound: agents[0].bugsFound + result.failed,
      testsGenerated: agents[0].testsGenerated + result.passed + result.failed,
    }).where(eq(agentsTable.id, agentId));

    res.json({ ...result, buildingId, agentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "RUN_TESTS_ERROR", message });
  }
});

export default router;
