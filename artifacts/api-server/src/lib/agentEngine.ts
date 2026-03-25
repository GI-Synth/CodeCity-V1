import { type NpcAgent } from "./types";
import { db } from "@workspace/db";
import { agentsTable, eventsTable } from "@workspace/db/schema";
import { wsServer } from "./wsServer";
import type { CityLayout, Building } from "./types";
import { and, desc, eq } from "drizzle-orm";
import { analyzeBuildingForAgent, type SmartAnalysisResult } from "./smartAgentWorkflow";
import { computeRank } from "./agentRanking";
import {
  getTopLanguageFromPersonalKb,
  mapRoleToPersona,
  parsePersonalKb,
  personaEmoji,
} from "./smartAgents";
import {
  classifyAndPersistBugFinding,
  recordDiscardedFindingEvent,
  recordObservationEvent,
} from "./findingQuality";

function emitThought(agentId: string, thought: string, duration = 3000): void {
  wsServer.broadcastThought(agentId, thought, duration);
}

const AGENT_NAMES: Record<string, string[]> = {
  qa_inspector: ["Inspector Rex", "QA Quinn", "Test Titan", "Vera Verifix", "Ace Auditor"],
  api_fuzzer: ["Fuzzy McFuzz", "API Breaker", "Zara Zero-Day", "Rex Randomizer", "Glitch Hunter"],
  load_tester: ["Max Overload", "Storm Surge", "Traffic Terry", "Pressure Pete", "Load Lord"],
  edge_explorer: ["Edge Eddie", "Boundary Bob", "Null Ninja", "Corner Case Carl", "Extreme Ellie"],
  ui_navigator: ["Click Clicker", "Browser Bot", "UI Uma", "Nav Nemesis", "Page Pilot"],
  scribe: ["Test Scribe", "Patch Quill", "Spec Smith", "Coverage Clerk", "Suite Weaver"],
};

const AGENT_COLORS: Record<string, string> = {
  qa_inspector: "#4a9eff",
  api_fuzzer: "#ff7a2a",
  load_tester: "#ffe44a",
  edge_explorer: "#4aff8c",
  ui_navigator: "#c44aff",
  scribe: "#6be675",
};

const IDLE_DIALOGUES: Record<string, string[]> = {
  qa_inspector: ["Scanning for uncovered functions...", "Looking for untested edge cases...", "Ready to generate test cases!"],
  api_fuzzer: ["Probing endpoints for weak spots...", "Sending malformed payloads...", "Testing auth bypass..."],
  load_tester: ["Simulating 1000 concurrent users...", "Watching for memory leaks under load...", "Stress testing database pool..."],
  edge_explorer: ["Testing null and undefined inputs...", "Exploring boundary conditions...", "Finding race conditions..."],
  ui_navigator: ["Navigating user flows...", "Checking mobile responsiveness...", "Automating user journeys..."],
  scribe: ["Drafting targeted tests...", "Turning findings into reproducible specs...", "Writing guards for fragile paths..."],
};

interface AgentState {
  id: string;
  status: "idle" | "moving" | "testing" | "escalating" | "reporting";
  visitedBuildings: Set<string>;
  recentFindings: string[];
  loopTimer?: ReturnType<typeof setInterval>;
}

const agentStates = new Map<string, AgentState>();
let currentLayout: CityLayout | null = null;

const activeTargets = new Set<string>();
const stoppedAgents = new Set<string>();

export function clearAllAgentIntervals(): void {
  stoppedAgents.clear();
  for (const id of agentStates.keys()) {
    stoppedAgents.add(id);
  }
  console.log(`[AgentLoop] Stopped ${stoppedAgents.size} agent loop(s)`);
}

function roleBonusScore(role: string, building: Building): number {
  const persona = mapRoleToPersona(role);

  if (persona === "inspector" && building.fileType === "function") return 3;
  if (persona === "inspector" && building.fileType === "class") return 2;
  if (persona === "guardian" && building.fileType === "api") return 5;
  if (persona === "architect" && building.complexity > 15) return 4;
  if (persona === "optimizer" && building.fileType === "api") return 3;
  if (persona === "alchemist" && building.fileType === "entry") return 2;
  if (persona === "scribe" && (!building.hasTests || building.testCoverage < 0.2)) return 6;
  return 0;
}

function applySpecialtyConstraint(
  agentRow: typeof agentsTable.$inferSelect,
  candidates: Building[],
): Building[] {
  if ((agentRow.specialtyScore ?? 0) <= 0.7) return candidates;

  const persona = mapRoleToPersona(agentRow.role);
  if (persona === "inspector") {
    const entries = parsePersonalKb(agentRow.personalKB);
    const topLanguage = getTopLanguageFromPersonalKb(entries);
    if (!topLanguage) return candidates;

    const filtered = candidates.filter(b => b.language.trim().toLowerCase() === topLanguage);
    if (filtered.length > 0) {
      console.log(`[SpecialtyTarget] ${agentRow.name} constrained to language=${topLanguage}`);
      return filtered;
    }
    return candidates;
  }

  if (persona === "guardian") {
    const filtered = candidates.filter(b => {
      const lowerPath = b.filePath.toLowerCase();
      return lowerPath.includes("auth") || lowerPath.includes("security") || lowerPath.includes("token") || lowerPath.includes("permission");
    });

    if (filtered.length > 0) {
      console.log(`[SpecialtyTarget] ${agentRow.name} constrained to security-adjacent paths`);
      return filtered;
    }
    return candidates;
  }

  if (persona === "optimizer") {
    const filtered = candidates.filter(b => b.complexity > 15);
    if (filtered.length > 0) {
      console.log(`[SpecialtyTarget] ${agentRow.name} constrained to complexity>15 files`);
      return filtered;
    }
    return candidates;
  }

  return candidates;
}

function chooseTarget(agentRow: typeof agentsTable.$inferSelect, visited: Set<string>, layout: CityLayout): Building | null {
  const allBuildings = layout.districts.flatMap(d => d.buildings);
  const candidates = allBuildings.filter(b => !visited.has(b.id) && !activeTargets.has(b.id));

  const basePool = candidates.length > 0 ? candidates : allBuildings.filter(b => !activeTargets.has(b.id));
  const pool = applySpecialtyConstraint(agentRow, basePool);

  if (pool.length === 0) return allBuildings[Math.floor(Math.random() * allBuildings.length)] ?? null;

  let best: Building = pool[0];
  let bestScore = -1;

  for (const b of pool) {
    const depCount = layout.roads.filter(r => r.fromBuilding === b.id || r.toBuilding === b.id).length;
    const score = b.complexity * (depCount + 1) + roleBonusScore(agentRow.role, b);
    if (score > bestScore) { bestScore = score; best = b; }
  }

  return best;
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string").map(value => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function pushUnique(items: string[], value: string, max = 120): string[] {
  const next = items.filter(item => item !== value);
  next.push(value);
  return next.slice(-max);
}

function formatPersonaLabel(persona: string): string {
  if (!persona) return "Specialist";
  return `${persona.charAt(0).toUpperCase()}${persona.slice(1)}`;
}

async function consultAgent(params: {
  requestingAgent: typeof agentsTable.$inferSelect;
  targetRole: "guardian" | "optimizer" | "architect" | "inspector" | "scribe" | "alchemist";
  filePath: string;
  building: Building;
  context: string;
}): Promise<SmartAnalysisResult | null> {
  const idleAgents: Array<typeof agentsTable.$inferSelect> = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.status, "idle"));

  const consultant = idleAgents.find(candidate => (
    candidate.id !== params.requestingAgent.id
    && mapRoleToPersona(candidate.role) === params.targetRole
  ));

  if (!consultant) {
    console.log(`[Consultation] No idle ${params.targetRole} available for ${params.requestingAgent.name}`);
    return null;
  }

  const requesterPersona = mapRoleToPersona(params.requestingAgent.role);
  const consultantPersona = mapRoleToPersona(consultant.role);

  const requesterEmoji = personaEmoji(requesterPersona);
  const consultantEmoji = personaEmoji(consultantPersona);

  const consultationLog = `${requesterEmoji} ${formatPersonaLabel(requesterPersona)} consulted ${consultantEmoji} ${formatPersonaLabel(consultantPersona)} on ${params.filePath}`;
  console.log(`[Consultation] ${consultationLog}`);

  await db.update(agentsTable).set({
    status: "working",
    currentBuilding: params.building.id,
    currentTask: "consulting",
  }).where(eq(agentsTable.id, consultant.id));

  try {
    const result = await analyzeBuildingForAgent({
      agentRow: consultant,
      building: params.building,
      context: params.context,
      consultedBy: params.requestingAgent.id,
    });

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-consult-${Math.random().toString(36).slice(2, 5)}`,
      type: "escalation",
      agentId: consultant.id,
      agentName: consultant.name,
      buildingId: params.building.id,
      buildingName: params.building.name,
      message: consultationLog,
      severity: "info",
    }).catch(() => {});

    wsServer.broadcastEventLog("CONSULTATION", consultationLog, "info");
    return result;
  } finally {
    await db.update(agentsTable).set({
      status: "idle",
      currentTask: null,
      currentBuilding: null,
    }).where(eq(agentsTable.id, consultant.id));
  }
}

async function runAgentCycle(agentId: string): Promise<void> {
  if (!currentLayout) return;

  let target: Building | null = null;
  try {
    const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (rows.length === 0) return;
    const agentRow = rows[0];
    if (agentRow.status === "paused" || agentRow.status === "retired") return;

    let state = agentStates.get(agentId);
    if (!state) {
      // Rehydrate recentFindings from persisted bug events so learned patterns
      // survive server restarts instead of being rediscovered from scratch.
      const recentBugEvents = await db
        .select({ filePath: eventsTable.filePath, findingText: eventsTable.findingText })
        .from(eventsTable)
        .where(and(eq(eventsTable.agentId, agentId), eq(eventsTable.type, "bug_found")))
        .orderBy(desc(eventsTable.timestamp))
        .limit(30)
        .catch((): Array<{ filePath: string | null; findingText: string | null }> => []);
      const rehydratedFindings = recentBugEvents
        .filter(e => e.filePath && e.findingText)
        .map(e => `${e.filePath}: ${(e.findingText ?? "").slice(0, 120)}`);
      state = { id: agentId, status: "idle", visitedBuildings: new Set(), recentFindings: rehydratedFindings };
      agentStates.set(agentId, state);
    }

    state.status = "moving";
    emitThought(agentId, "Scanning for high-value specialist targets...");
    target = chooseTarget(agentRow, state.visitedBuildings, currentLayout);
    if (!target) return;
    let observations = parseStringArray(agentRow.observations);

    activeTargets.add(target.id);

    state.visitedBuildings.add(target.id);
    if (state.visitedBuildings.size > 20) {
      const first = state.visitedBuildings.values().next().value;
      if (first) state.visitedBuildings.delete(first);
    }

    wsServer.broadcastNPCMove(agentId, target.id, target.x + target.width / 2, target.y + target.height / 2);

    await db.update(agentsTable).set({
      currentBuilding: target.id,
      currentTask: "moving",
      status: "working",
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    }).where(eq(agentsTable.id, agentId));

    await new Promise(r => setTimeout(r, 1200));

    state.status = "testing";
    await db.update(agentsTable).set({ currentTask: "analyzing" }).where(eq(agentsTable.id, agentId));
    emitThought(agentId, `Running ${mapRoleToPersona(agentRow.role)} analysis on ${target.name}...`);

    const primaryResult = await analyzeBuildingForAgent({
      agentRow,
      building: target,
      context: `Autonomous cycle for ${agentRow.name}`,
    });

    let bugsFound = primaryResult.bugsFound;
    let testsGenerated = primaryResult.testsGenerated;
    const escalated = primaryResult.escalated;
    const kbHit = primaryResult.fromKnowledgeBase;

    if (primaryResult.classification === "bug") {
      if (primaryResult.findingText && primaryResult.issueType && primaryResult.codeReference) {
        const persisted = await classifyAndPersistBugFinding({
          agentId,
          agentName: agentRow.name,
          buildingId: target.id,
          buildingName: target.name,
          filePath: target.filePath,
          findingText: primaryResult.findingText,
          issueType: primaryResult.issueType,
          confidence: primaryResult.finalConfidence,
          codeReference: primaryResult.codeReference,
        });

        bugsFound = persisted.status === "new" ? 1 : 0;
        state.recentFindings.push(`${target.filePath}: ${(primaryResult.findingText ?? "bug finding").slice(0, 120)}`);

        if (bugsFound > 0) {
          emitThought(agentId, `High-confidence issue found in ${target.name}.`, 4500);
          wsServer.broadcastBugFound(
            target.id,
            persisted.severity === "CRITICAL" ? "critical" : "warning",
            `${agentRow.name} reported ${persisted.severity} issue in ${target.name}: ${primaryResult.codeReference}`,
          );
        }
      } else {
        bugsFound = 0;
      }
    }

    if (primaryResult.classification === "observation" && primaryResult.findingText) {
      observations = pushUnique(observations, primaryResult.findingText);
      await recordObservationEvent({
        agentId,
        agentName: agentRow.name,
        buildingId: target.id,
        buildingName: target.name,
        filePath: target.filePath,
        observation: primaryResult.findingText,
        confidence: primaryResult.finalConfidence,
        eventType: primaryResult.qualityReason === "low_confidence"
          ? "finding_low_confidence"
          : "finding_observation",
      });
    }

    if (primaryResult.classification === "discarded" && primaryResult.findingText) {
      await recordDiscardedFindingEvent({
        agentId,
        agentName: agentRow.name,
        buildingId: target.id,
        buildingName: target.name,
        filePath: target.filePath,
        findingText: primaryResult.findingText,
        reason: primaryResult.qualityReason ?? "discarded",
        confidence: primaryResult.finalConfidence,
        eventType: primaryResult.qualityReason === "generic"
          ? "finding_discarded_generic"
          : "finding_discarded",
      });
    }

    if (primaryResult.classification === "test_target") {
      testsGenerated += 1;
      observations = pushUnique(observations, primaryResult.summary);
    }

    const persona = mapRoleToPersona(agentRow.role);
    if (persona === "inspector" && primaryResult.classification === "bug" && primaryResult.isSecurityAdjacent) {
      emitThought(agentId, "Security-adjacent finding detected. Consulting Guardian...", 4500);
      const consultation = await consultAgent({
        requestingAgent: agentRow,
        targetRole: "guardian",
        filePath: target.filePath,
        building: target,
        context: `Inspector finding: ${primaryResult.findingText ?? "security-adjacent issue"}`,
      });

      if (consultation?.classification === "bug") {
        bugsFound += consultation.bugsFound;
        wsServer.broadcastEventLog(
          "CONSULTATION_CONFIRMED",
          `${agentRow.name} and Guardian confirmed a security issue in ${target.filePath}`,
          "warning",
        );
      }
    }

    emitThought(agentId, "Filing report at the tower.");

    const newTotalTasks = agentRow.totalTasksCompleted + 1;
    const newBugsTotal = agentRow.bugsFound + bugsFound;
    const newTruePositives = agentRow.truePositives + (bugsFound > 0 ? bugsFound : 0);
    const newEscalationCount = agentRow.escalationCount + (escalated ? 1 : 0);
    const newKbHits = (agentRow.kbHits ?? 0) + (kbHit ? 1 : 0);
    const newRank = computeRank(newTotalTasks, agentRow.accuracy, newTruePositives);
    const specialtyAdjustment = primaryResult.classification === "bug"
      ? 0.04
      : primaryResult.classification === "observation"
        ? 0.01
        : primaryResult.classification === "discarded"
          ? -0.01
          : 0.02;
    const nextSpecialtyScore = Math.max(0, Math.min(1, (agentRow.specialtyScore ?? 0) + specialtyAdjustment));

    await db.update(agentsTable).set({
      currentTask: "reporting",
      bugsFound: newBugsTotal,
      testsGenerated: agentRow.testsGenerated + testsGenerated,
      escalations: agentRow.escalations + (escalated ? 1 : 0),
      escalationCount: newEscalationCount,
      kbHits: newKbHits,
      observations: JSON.stringify(observations),
      truePositives: newTruePositives,
      totalTasksCompleted: newTotalTasks,
      rank: newRank,
      specialtyScore: nextSpecialtyScore,
      status: "reporting",
      x: 50,
      y: 50,
    }).where(eq(agentsTable.id, agentId));

    wsServer.broadcastNPCMove(agentId, "tower", 50, 50);

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: "task_complete",
      agentId,
      agentName: agentRow.name,
      buildingId: target.id,
      buildingName: target.name,
      message: `${agentRow.name} completed ${target.name} analysis (${primaryResult.classification})${bugsFound > 0 ? `, found ${bugsFound} bug(s)` : ""}`,
      severity: bugsFound > 0 ? "warning" : "info",
    });

    wsServer.broadcastEventLog("TASK_COMPLETE", `${agentRow.name} analyzed ${target.name}`, bugsFound > 0 ? "warning" : "info");

    if (newBugsTotal >= agentRow.level * 10) {
      const newLevel = agentRow.level + 1;
      await db.update(agentsTable).set({ level: newLevel }).where(eq(agentsTable.id, agentId));
      wsServer.broadcastEventLog("AGENT_PROMOTED", `${agentRow.name} promoted to Level ${newLevel}!`, "info");
    }

    await db.update(agentsTable).set({ currentTask: null, status: "idle" }).where(eq(agentsTable.id, agentId));
    state.status = "idle";
  } catch (err) {
    console.error('[AgentCycle] error:', err);
  }
  if (target && target.id) activeTargets.delete(target.id);
}

export async function startAgentLoop(): Promise<void> {
  console.log("[AgentLoop] Starting agent background loop");

  await new Promise(r => setTimeout(r, 3000));

  const refreshLayout = async () => {
    try {
      const { db: dbClient } = await import("@workspace/db");
      const { reposTable } = await import("@workspace/db/schema");
      const { desc } = await import("drizzle-orm");
      const repos = await dbClient.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
      if (repos.length > 0 && repos[0].layoutData) {
        currentLayout = JSON.parse(repos[0].layoutData);
      } else {
        currentLayout = null;
      }
    } catch (e) {
      console.warn("[AgentLoop] Failed to load layout:", e);
    }
  };

  await refreshLayout();
  setInterval(refreshLayout, 30000);

  const scheduleAgent = async (agentId: string, delay: number) => {
    await new Promise(r => setTimeout(r, delay));
    const loop = async () => {
      if (stoppedAgents.has(agentId)) return;
      try {
        await runAgentCycle(agentId);
      } catch (e) {
        console.warn(`[AgentLoop] Agent ${agentId} cycle error:`, e);
      }
      if (stoppedAgents.has(agentId)) return;
      const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).catch(() => []);
      const interval = rows.length > 0 ? Math.max(4000, 8000 - (rows[0].level - 1) * 1000) : 8000;
      setTimeout(loop, interval);
    };
    loop();
  };

  const agents = await db.select().from(agentsTable).catch(() => []);
  for (let i = 0; i < agents.length; i++) {
    scheduleAgent(agents[i].id, i * 2000);
  }

  setInterval(async () => {
    try {
      const latest = await db.select().from(agentsTable);
      const running = new Set(agentStates.keys());
      for (const a of latest) {
        if (!running.has(a.id) && !stoppedAgents.has(a.id)) {
          scheduleAgent(a.id, 1000);
          agentStates.set(a.id, { id: a.id, status: "idle", visitedBuildings: new Set(), recentFindings: [] });
        }
      }
    } catch { }
  }, 15000);
}

export function updateCityLayout(layout: CityLayout): void {
  currentLayout = layout;
}

export function createAgent(role: NpcAgent["role"], targetBuilding: string | null = null): NpcAgent {
  const names = AGENT_NAMES[role];
  const name = names[Math.floor(Math.random() * names.length)];
  const dialogues = IDLE_DIALOGUES[role];

  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    role,
    status: "idle",
    currentBuilding: targetBuilding,
    currentTask: null,
    bugsFound: 0,
    testsGenerated: 0,
    escalations: 0,
    accuracy: 0.75 + Math.random() * 0.2,
    level: 1,
    dialogue: dialogues[Math.floor(Math.random() * dialogues.length)],
    x: Math.random() * 800,
    y: Math.random() * 600,
    color: AGENT_COLORS[role],
  };
}

export function getAgentDialogue(agent: NpcAgent): string {
  if (agent.status === "escalating") return "This is beyond my local knowledge. Calling senior AI...";
  if (agent.status === "working") return "Running analysis protocol...";
  const dialogues = IDLE_DIALOGUES[agent.role];
  return dialogues[Math.floor(Math.random() * dialogues.length)];
}

export function simulateAgentTask(
  _agent: NpcAgent,
  taskType: string,
  buildingName: string,
  context: string,
): { result: string; actionItems: string[]; bugsFound: number; escalated: boolean; fromKnowledgeBase: boolean } {
  const normalizedTask = String(taskType || "analyze_bug");
  const safeContext = context?.trim() || `building:${buildingName}`;

  const results: Record<string, string> = {
    generate_tests: `Prepared a test-generation request for ${buildingName}. No test execution has occurred yet.`,
    analyze_bug: `Prepared a static inspection request for ${buildingName}. No verified bug finding has been emitted.`,
    fuzz_api: `Prepared an API fuzzing request for ${buildingName}. No runtime fuzz execution has occurred yet.`,
    load_test: `Prepared a load-test request for ${buildingName}. No live traffic simulation has run yet.`,
    explore_edge_cases: `Prepared an edge-case exploration request for ${buildingName}. No executable checks have run yet.`,
  };

  const actionItems = [
    `Review context: ${safeContext}`,
    "Use the Run Tests action for verifiable pass/fail results",
    "Treat this task result as a queued analysis note, not a confirmed bug",
  ];

  return {
    result: results[normalizedTask] ?? `Prepared ${normalizedTask} request for ${buildingName}.`,
    actionItems,
    bugsFound: 0,
    escalated: false,
    fromKnowledgeBase: false,
  };
}
