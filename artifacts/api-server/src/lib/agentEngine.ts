import { type NpcAgent } from "./types";
import { db } from "@workspace/db";
import { agentsTable, eventsTable } from "@workspace/db/schema";
import { wsServer } from "./wsServer";
import { ollamaClient } from "./ollamaClient";
import { buildTestGenerationPrompt } from "./ollamaPrompts";
import { escalate } from "./escalationEngine";
import type { CityLayout, Building } from "./types";
import { eq } from "drizzle-orm";

const AGENT_NAMES: Record<string, string[]> = {
  qa_inspector: ["Inspector Rex", "QA Quinn", "Test Titan", "Vera Verifix", "Ace Auditor"],
  api_fuzzer: ["Fuzzy McFuzz", "API Breaker", "Zara Zero-Day", "Rex Randomizer", "Glitch Hunter"],
  load_tester: ["Max Overload", "Storm Surge", "Traffic Terry", "Pressure Pete", "Load Lord"],
  edge_explorer: ["Edge Eddie", "Boundary Bob", "Null Ninja", "Corner Case Carl", "Extreme Ellie"],
  ui_navigator: ["Click Clicker", "Browser Bot", "UI Uma", "Nav Nemesis", "Page Pilot"],
};

const AGENT_COLORS: Record<string, string> = {
  qa_inspector: "#4a9eff",
  api_fuzzer: "#ff7a2a",
  load_tester: "#ffe44a",
  edge_explorer: "#4aff8c",
  ui_navigator: "#c44aff",
};

const IDLE_DIALOGUES: Record<string, string[]> = {
  qa_inspector: ["Scanning for uncovered functions...", "Looking for untested edge cases...", "Ready to generate test cases!"],
  api_fuzzer: ["Probing endpoints for weak spots...", "Sending malformed payloads...", "Testing auth bypass..."],
  load_tester: ["Simulating 1000 concurrent users...", "Watching for memory leaks under load...", "Stress testing database pool..."],
  edge_explorer: ["Testing null and undefined inputs...", "Exploring boundary conditions...", "Finding race conditions..."],
  ui_navigator: ["Navigating user flows...", "Checking mobile responsiveness...", "Automating user journeys..."],
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

function roleBonusScore(role: string, building: Building): number {
  if (role === "qa_inspector" && building.fileType === "function") return 3;
  if (role === "qa_inspector" && building.fileType === "class") return 2;
  if (role === "api_fuzzer" && building.fileType === "api") return 5;
  if (role === "edge_explorer" && building.complexity > 15) return 4;
  if (role === "load_tester" && building.fileType === "api") return 3;
  if (role === "ui_navigator" && building.fileType === "entry") return 3;
  return 0;
}

function chooseTarget(agentRole: string, visited: Set<string>, layout: CityLayout): Building | null {
  const allBuildings = layout.districts.flatMap(d => d.buildings);
  const candidates = allBuildings.filter(b => !visited.has(b.id));

  if (candidates.length === 0) return allBuildings[Math.floor(Math.random() * allBuildings.length)] ?? null;

  let best: Building = candidates[0];
  let bestScore = -1;

  for (const b of candidates) {
    const depCount = layout.roads.filter(r => r.fromBuilding === b.id || r.toBuilding === b.id).length;
    const score = b.complexity * (depCount + 1) + roleBonusScore(agentRole, b);
    if (score > bestScore) { bestScore = score; best = b; }
  }

  return best;
}

function parseTestJSON(raw: string): Array<{ name: string; input: unknown; expected: unknown }> {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]) as Array<{ name: string; input: unknown; expected: unknown }>;
    if (!Array.isArray(arr)) return [];
    return arr.filter(t => t.name && (t.input !== null || t.expected !== null));
  } catch {
    return [];
  }
}

async function runAgentCycle(agentId: string): Promise<void> {
  if (!currentLayout) return;

  const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (rows.length === 0) return;
  const agentRow = rows[0];

  let state = agentStates.get(agentId);
  if (!state) {
    state = { id: agentId, status: "idle", visitedBuildings: new Set(), recentFindings: [] };
    agentStates.set(agentId, state);
  }

  state.status = "moving";
  const target = chooseTarget(agentRow.role, state.visitedBuildings, currentLayout);
  if (!target) return;

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

  await new Promise(r => setTimeout(r, 1500));

  state.status = "testing";
  const { system, prompt } = buildTestGenerationPrompt(target.name, target.filePath, target.language);

  let tests: Array<{ name: string; input: unknown; expected: unknown }> = [];
  let localSucceeded = false;
  const attempts: string[] = [];

  const ollamaAvailable = await ollamaClient.isAvailable();
  if (ollamaAvailable) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await ollamaClient.generate({
          model: "deepseek-coder-v2:16b",
          system,
          prompt,
          temperature: 0.4 + attempt * 0.1,
          maxTokens: 1000,
        });
        const parsed = parseTestJSON(result);
        if (parsed.length > 0 && !parsed.every(t => t.input === null)) {
          tests = parsed;
          localSucceeded = true;
          attempts.push(`Attempt ${attempt + 1}: generated ${parsed.length} tests`);
          break;
        } else {
          attempts.push(`Attempt ${attempt + 1}: trivial or empty result`);
        }
      } catch (e) {
        attempts.push(`Attempt ${attempt + 1}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }

  let bugsFound = 0;
  let escalated = false;

  if (localSucceeded && tests.length > 0) {
    await db.update(agentsTable).set({ currentTask: "testing" }).where(eq(agentsTable.id, agentId));

    bugsFound = Math.min(tests.length, Math.floor(target.complexity / 8));
    for (let i = 0; i < bugsFound; i++) {
      const severity = target.complexity > 20 ? "critical" : "warning";
      wsServer.broadcastBugFound(target.id, severity, `${agentRow.name} found a bug in ${target.name}: test case "${tests[i]?.name ?? "edge case"}" failed`);
    }

    if (bugsFound > 0) {
      state.recentFindings.push(`Found ${bugsFound} bug(s) in ${target.name}`);
      if (state.recentFindings.length > 5) state.recentFindings.shift();
    }
  } else {
    state.status = "escalating";
    escalated = true;

    await db.update(agentsTable).set({ currentTask: "escalating" }).where(eq(agentsTable.id, agentId));
    wsServer.broadcastEscalation(agentId, target.id, false, "pending");

    try {
      const result = await escalate({
        question: `What bugs might exist in ${target.name} (${target.language} file with complexity ${target.complexity})?`,
        codeSnippet: `File: ${target.filePath}\nLanguage: ${target.language}\nLOC: ${target.linesOfCode}\nComplexity: ${target.complexity}`,
        language: target.language,
        failedAttempts: attempts,
      });

      wsServer.broadcastEscalation(agentId, target.id, result.source === "knowledge_base", result.source);

      if (result.confidence > 0.5) {
        bugsFound = result.action_items.length > 0 ? 1 : 0;
        state.recentFindings.push(`Escalated for ${target.name}: ${result.answer.slice(0, 80)}`);
      }
    } catch { }
  }

  await db.update(agentsTable).set({
    currentTask: "reporting",
    bugsFound: agentRow.bugsFound + bugsFound,
    testsGenerated: agentRow.testsGenerated + tests.length,
    escalations: agentRow.escalations + (escalated ? 1 : 0),
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
    message: `${agentRow.name} completed ${tests.length} tests on ${target.name}${bugsFound > 0 ? `, found ${bugsFound} bug(s)` : ""}`,
    severity: bugsFound > 0 ? "warning" : "info",
  });

  wsServer.broadcastEventLog("TASK_COMPLETE", `${agentRow.name} analyzed ${target.name}`, bugsFound > 0 ? "warning" : "info");

  const newBugsTotal = agentRow.bugsFound + bugsFound;
  if (newBugsTotal >= agentRow.level * 10) {
    const newLevel = agentRow.level + 1;
    await db.update(agentsTable).set({ level: newLevel }).where(eq(agentsTable.id, agentId));
    wsServer.broadcastEventLog("AGENT_PROMOTED", `${agentRow.name} promoted to Level ${newLevel}!`, "info");
  }

  await db.update(agentsTable).set({ currentTask: null, status: "idle" }).where(eq(agentsTable.id, agentId));
  state.status = "idle";
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
        const { generateDemoRepo } = await import("./githubFetcher");
        const { buildCityLayout } = await import("./cityAnalyzer");
        const { files, repoName } = generateDemoRepo();
        currentLayout = buildCityLayout(files, repoName);
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
      try {
        await runAgentCycle(agentId);
      } catch (e) {
        console.warn(`[AgentLoop] Agent ${agentId} cycle error:`, e);
      }
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
        if (!running.has(a.id)) {
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
  agent: NpcAgent,
  taskType: string,
  buildingName: string,
  _context: string,
): { result: string; actionItems: string[]; bugsFound: number; escalated: boolean; fromKnowledgeBase: boolean } {
  const bugsFound = Math.random() < 0.35 ? Math.floor(Math.random() * 3) + 1 : 0;
  const escalated = agent.escalations < 5 && Math.random() < 0.06;
  const fromKnowledgeBase = !escalated && Math.random() < 0.3;

  const results: Record<string, string> = {
    generate_tests: `Generated ${Math.floor(Math.random() * 8) + 3} test cases for ${buildingName}. Found ${bugsFound} potential issues.`,
    analyze_bug: `Analyzed ${buildingName}. ${bugsFound > 0 ? `Found ${bugsFound} bugs in error handling paths.` : "No critical bugs found."}`,
    fuzz_api: `Fuzzed ${buildingName} with 500 random payloads. ${bugsFound > 0 ? `${bugsFound} endpoints vulnerable.` : "All endpoints handled edge inputs gracefully."}`,
    load_test: `Load tested ${buildingName} with 100-2000 concurrent requests. ${bugsFound > 0 ? "Memory leak detected under load." : "Performance stable."}`,
    explore_edge_cases: `Explored ${Math.floor(Math.random() * 20 + 10)} edge cases in ${buildingName}. ${bugsFound > 0 ? `${bugsFound} caused unexpected behavior.` : "All handled correctly."}`,
  };

  const actionItems = bugsFound > 0
    ? [`Add null checks in ${buildingName}`, "Increase test coverage for error paths", "Review async error handling"].slice(0, bugsFound + 1)
    : ["Consider adding more edge case tests", "Document the current behavior"];

  return { result: results[taskType] ?? `Completed ${taskType} on ${buildingName}.`, actionItems, bugsFound, escalated, fromKnowledgeBase };
}
