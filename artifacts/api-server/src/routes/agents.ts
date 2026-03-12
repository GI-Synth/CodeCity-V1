import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentsTable, eventsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createAgent, simulateAgentTask, simulateAgentChat } from "../lib/agentEngine";

const router: IRouter = Router();

// Seed some initial agents if none exist
async function ensureAgents() {
  const existing = await db.select().from(agentsTable).limit(1);
  if (existing.length === 0) {
    const roles: Array<"qa_inspector" | "api_fuzzer" | "load_tester" | "edge_explorer" | "ui_navigator"> = [
      "qa_inspector", "api_fuzzer", "load_tester", "edge_explorer", "ui_navigator"
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

    // Simulate dynamic agent movement/status
    const liveAgents = agents.map(a => ({
      ...a,
      x: (a.x + Math.random() * 10 - 5 + 800) % 800,
      y: (a.y + Math.random() * 10 - 5 + 600) % 600,
      status: Math.random() > 0.3 ? "working" : "idle",
    }));

    res.json({ agents: liveAgents, total: liveAgents.length });
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

    // Log event
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

router.post("/:agentId/task", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { taskType, buildingId, context } = req.body;

    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Agent not found" });
    }

    const agent = agents[0];
    const taskResult = simulateAgentTask(
      agent as any,
      taskType,
      buildingId,
      context
    );

    // Update agent stats
    await db.update(agentsTable).set({
      bugsFound: agent.bugsFound + taskResult.bugsFound,
      testsGenerated: agent.testsGenerated + (taskType === "generate_tests" ? 5 : 0),
      escalations: agent.escalations + (taskResult.escalated ? 1 : 0),
      currentBuilding: buildingId,
      currentTask: taskType,
      status: "reporting",
    }).where(eq(agentsTable.id, agentId));

    // Log event if bugs found
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

    res.json({
      success: true,
      taskType,
      ...taskResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "TASK_ERROR", message });
  }
});

router.post("/:agentId/chat", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { message, buildingContext } = req.body;

    const agents = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (agents.length === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Agent not found" });
    }

    const agent = agents[0];
    const chatResult = simulateAgentChat(agent as any, message, buildingContext ?? null);

    if (chatResult.escalated) {
      await db.insert(eventsTable).values({
        id: `evt-${Date.now()}`,
        type: "escalation",
        agentId,
        agentName: agent.name,
        message: `${agent.name} escalated a question to external AI`,
        severity: "info",
      });
    }

    res.json({
      agentId,
      agentName: agent.name,
      ...chatResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "CHAT_ERROR", message });
  }
});

export default router;
