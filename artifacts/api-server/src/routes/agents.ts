import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentsTable, eventsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createAgent, simulateAgentTask } from "../lib/agentEngine";
import { generateDialogue, escalate } from "../lib/escalationEngine";

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

export default router;
