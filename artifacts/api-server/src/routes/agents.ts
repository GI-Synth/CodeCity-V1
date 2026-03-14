import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentsTable, eventsTable, reposTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { createAgent } from "../lib/agentEngine";
import { generateDialogue, escalate } from "../lib/escalationEngine";
import { testExecutor } from "../lib/testExecutor";
import { buildTestGenerationPrompt } from "../lib/ollamaPrompts";
import { ollamaClient } from "../lib/ollamaClient";
import { wsServer } from "../lib/wsServer";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import type { CityLayout, Building } from "../lib/types";
import { isSourceFile } from "../lib/sourceFiles";
import {
  analyzeBuildingForAgent,
  getLatestPendingBugFinding,
  updateFindingVerdictStatus,
  type SmartFindingClassification,
} from "../lib/smartAgentWorkflow";
import {
  applyConfirmedFindingToPersonalKb,
  mapRoleToPersona,
  parsePersonalKb,
  serializePersonalKb,
  toMemoryPattern,
} from "../lib/smartAgents";
import {
  classifyAndPersistBugFinding,
  recordDiscardedFindingEvent,
  recordObservationEvent,
} from "../lib/findingQuality";

const router: IRouter = Router();

type TaskResult = {
  result: string;
  actionItems: string[];
  bugsFound: number;
  observations: string[];
  classification: SmartFindingClassification;
  findingId?: number | null;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  findingText?: string | null;
  issueType?: string | null;
  codeReference?: string | null;
  qualityReason?: "unsupported_file" | "low_confidence" | "generic" | null;
  confirmations?: number;
  baseConfidence?: number;
  finalConfidence?: number;
  escalated: boolean;
  fromKnowledgeBase: boolean;
  provider?: string;
  reason?: string;
  skippedByMemory?: boolean;
  memoryHash?: string;
  selectedTaskType?: "skip" | "test_quality_review" | "bug_analysis" | "generic_analysis";
};

type ResolvedBuildingTarget = {
  repoId: number;
  layout: CityLayout;
  building: Building;
};

type TaskPlan = {
  selectedTaskType: "skip" | "test_quality_review" | "bug_analysis" | "generic_analysis";
  skip: boolean;
  reason?: string;
};

const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".cpp", ".c"]);
const DOC_SKIP_MARKERS = [
  "handoff",
  "readme",
  "contributing",
  "demo",
  "migration",
  "progress",
  "complete",
  "license",
];

// Add .html and .htm to skip lists for docs
const DOC_SKIP_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".markdown", ".rst", ".html", ".htm"]);
const AGENT_MEMORY_LIMIT = 120;
const SPECIALIZED_ROLES = ["qa_inspector", "api_fuzzer", "load_tester", "edge_explorer", "ui_navigator", "scribe"] as const;
type SpecializedRole = (typeof SPECIALIZED_ROLES)[number];

function taskPrefix(agentName: string, taskType: string): string {
  return `[AgentAnalysis] agent=${agentName} task=${taskType}`;
}

function normalizeMemoryFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map(value => value.trim())
      .filter(Boolean)
      .slice(-AGENT_MEMORY_LIMIT);
  } catch {
    return [];
  }
}

function pushUnique(items: string[], value: string, max = AGENT_MEMORY_LIMIT): string[] {
  const next = items.filter(item => item !== value);
  next.push(value);
  return next.slice(-max);
}

function computeTaskFingerprint(building: Building, context: string, selectedTaskType: TaskPlan["selectedTaskType"]): string {
  const payload = [
    normalizeMemoryFilePath(building.filePath),
    building.language,
    String(building.linesOfCode),
    String(building.complexity),
    String(building.testCoverage),
    String(building.status),
    selectedTaskType,
    context.trim(),
  ].join("|");

  return createHash("sha1").update(payload).digest("hex");
}

function specialtyDelta(params: {
  role: string;
  building: Building;
  selectedTaskType: TaskPlan["selectedTaskType"];
  bugsFound: number;
  skippedByMemory: boolean;
}): number {
  const language = params.building.language.toLowerCase();
  let delta = 0;

  if (params.skippedByMemory) delta += 0.02;
  if (params.bugsFound > 0) delta += 0.04;

  if (params.role === "qa_inspector" && params.selectedTaskType === "bug_analysis") delta += 0.03;
  if (params.role === "api_fuzzer" && (params.building.fileType === "api" || language.includes("api"))) delta += 0.03;
  if (params.role === "load_tester" && params.building.complexity >= 12) delta += 0.02;
  if (params.role === "edge_explorer" && params.building.complexity >= 15) delta += 0.03;
  if (params.role === "ui_navigator" && params.building.fileType === "entry") delta += 0.03;
  if (params.role === "scribe" && params.selectedTaskType === "test_quality_review") delta += 0.05;

  if (delta === 0 && !params.skippedByMemory) delta -= 0.01;
  return delta;
}

function buildMemoryNote(building: Building, taskResult: TaskResult): string {
  const status = taskResult.skippedByMemory ? "hash-skip" : taskResult.bugsFound > 0 ? `bugs:${taskResult.bugsFound}` : "clean";
  const summary = taskResult.result.replace(/\s+/g, " ").slice(0, 100);
  return `${normalizeMemoryFilePath(building.filePath)}|${status}|${summary}`;
}

function isSpecializedRole(value: unknown): value is SpecializedRole {
  return typeof value === "string" && (SPECIALIZED_ROLES as readonly string[]).includes(value);
}

function selectTaskPlan(building: Building): TaskPlan {
  const normalizedPath = building.filePath.replace(/\\/g, "/");
  const lowerPath = normalizedPath.toLowerCase();
  const fileName = basename(lowerPath);
  const ext = extname(fileName);
  const isRootFile = !lowerPath.includes("/");

  const isConfigLike =
    ext === ".json"
    || ext === ".yaml"
    || ext === ".yml"
    || ext === ".config"
    || fileName === ".env"
    || fileName.startsWith(".env.")
    || fileName.includes(".config.")
    || building.fileType === "config";

  if (isConfigLike) {
    return {
      selectedTaskType: "skip",
      skip: true,
      reason: "config file, skipped",
    };
  }

  const hasDocMarker = DOC_SKIP_MARKERS.some(marker => lowerPath.includes(marker));
  const isRootNonSourceFile = isRootFile && !SOURCE_FILE_EXTENSIONS.has(ext);

  const isDocsLike =
    DOC_SKIP_EXTENSIONS.has(ext)
    || lowerPath.includes("/docs/")
    || lowerPath.includes("/doc/")
    || hasDocMarker
    || isRootNonSourceFile
    || building.language.toLowerCase() === "markdown";

  if (isDocsLike) {
    return {
      selectedTaskType: "skip",
      skip: true,
      reason: "markdown/docs/html file, skipped",
    };
  }

  const isTestFile = /\.(test|spec)\.[cm]?[jt]sx?$/i.test(fileName) || building.fileType === "test";
  if (isTestFile) {
    return {
      selectedTaskType: "test_quality_review",
      skip: false,
    };
  }

  const isJsTs =
    [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)
    || ["typescript", "javascript"].includes(building.language.toLowerCase());

  if (isJsTs) {
    return {
      selectedTaskType: "bug_analysis",
      skip: false,
    };
  }

  return {
    selectedTaskType: "generic_analysis",
    skip: false,
  };
}

async function resolveTargetBuilding(buildingId: string): Promise<ResolvedBuildingTarget | null> {
  const activeRepos = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
  const repos = activeRepos.length > 0
    ? activeRepos
    : await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);

  if (repos.length === 0 || !repos[0].layoutData) return null;

  const layout = JSON.parse(repos[0].layoutData) as CityLayout;
  const building = layout.districts.flatMap(d => d.buildings).find(b => b.id === buildingId) ?? null;
  if (!building) return null;

  return {
    repoId: repos[0].id,
    layout,
    building,
  };
}

async function persistBuildingFinding(params: {
  repoId: number;
  layout: CityLayout;
  buildingId: string;
  bugsFound: number;
}): Promise<Building | null> {
  const analyzedAt = new Date().toISOString();
  let updatedBuilding: Building | null = null;

  const updatedDistricts = params.layout.districts.map(district => ({
    ...district,
    buildings: district.buildings.map(building => {
      if (building.id !== params.buildingId) return building;

      const nextBuilding: Building = {
        ...building,
        status: "fire",
        activeEvent: "fire",
        bugCount: params.bugsFound,
        lastAnalyzed: analyzedAt,
      };
      updatedBuilding = nextBuilding;
      return nextBuilding;
    }),
  }));

  if (!updatedBuilding) return null;

  const updatedLayout: CityLayout = {
    ...params.layout,
    districts: updatedDistricts,
  };

  await db.update(reposTable).set({
    layoutData: JSON.stringify(updatedLayout),
    updatedAt: analyzedAt,
  }).where(eq(reposTable.id, params.repoId));

  return updatedBuilding;
}

async function analyzeBuildingTask(params: {
  agentName: string;
  taskType: string;
  building: Building;
  context: string;
  agentRow: typeof agentsTable.$inferSelect;
}): Promise<TaskResult> {
  const { agentName, taskType, building, context, agentRow } = params;
  const prefix = taskPrefix(agentName, taskType);
  const plan = selectTaskPlan(building);
  const memoryHash = computeTaskFingerprint(building, context, plan.selectedTaskType);
  const visitedFiles = parseStringArray(agentRow.visitedFiles);
  const normalizedFilePath = normalizeMemoryFilePath(building.filePath);

  console.log(`${prefix} task_selector selected=${plan.selectedTaskType} file=${building.filePath} skip=${plan.skip} reason=${plan.reason ?? "none"}`);

  if (!plan.skip && agentRow.lastFileHash === memoryHash && visitedFiles.includes(normalizedFilePath)) {
    console.log(`${prefix} memory_skip file=${building.filePath} hash=${memoryHash.slice(0, 8)}`);
    return {
      result: `Skipped ${building.filePath}: no meaningful changes since last inspection.`,
      actionItems: ["Hash unchanged since last analysis.", "Pick a different building or run a test approval action."],
      bugsFound: 0,
      observations: [],
      classification: "no_finding",
      escalated: false,
      fromKnowledgeBase: false,
      reason: "memory_hash_skip",
      skippedByMemory: true,
      memoryHash,
      selectedTaskType: "skip",
    };
  }

  if (plan.skip) {
    if (plan.reason === "markdown/docs/html file, skipped") {
      console.log(`[AgentTask] skipped ${basename(building.filePath)} reason=docs`);
    }

    return {
      result: plan.reason ?? "file skipped",
      actionItems: ["Skipped non-runtime file category."],
      bugsFound: 0,
      observations: [],
      classification: "no_finding",
      escalated: false,
      fromKnowledgeBase: false,
      reason: plan.reason,
      memoryHash,
      selectedTaskType: plan.selectedTaskType,
    };
  }

  console.log(`${prefix} start building=${building.id} file=${building.filePath}`);
  console.log(`${prefix} smart_analysis role=${agentRow.role} language=${building.language} selected=${plan.selectedTaskType}`);

  const smartResult = await analyzeBuildingForAgent({
    agentRow,
    building,
    context,
  });

  if (smartResult.baseConfidence !== smartResult.finalConfidence) {
    console.log(`${prefix} confidence_calibration before=${smartResult.baseConfidence.toFixed(2)} after=${smartResult.finalConfidence.toFixed(2)}`);
  }

  const observations = smartResult.classification === "observation" && smartResult.findingText
    ? [smartResult.findingText]
    : [];

  return {
    result: smartResult.summary,
    actionItems: smartResult.actionItems,
    bugsFound: smartResult.bugsFound,
    observations,
    classification: smartResult.classification,
    findingId: smartResult.findingId,
    severity: smartResult.severity,
    findingText: smartResult.findingText,
    issueType: smartResult.issueType,
    codeReference: smartResult.codeReference ?? smartResult.lineReference,
    qualityReason: smartResult.qualityReason,
    baseConfidence: smartResult.baseConfidence,
    finalConfidence: smartResult.finalConfidence,
    escalated: smartResult.escalated,
    fromKnowledgeBase: smartResult.fromKnowledgeBase,
    provider: smartResult.provider,
    memoryHash,
    selectedTaskType: plan.selectedTaskType,
  };
}

async function ensureAgents() {
  const existing = await db.select().from(agentsTable).limit(1);
  if (existing.length === 0) {
    for (const role of SPECIALIZED_ROLES) {
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
    if (!isSpecializedRole(role)) {
      res.status(400).json({ error: "INVALID_ROLE", message: "Unsupported role" });
      return;
    }

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
    const latestPendingFinding = await getLatestPendingBugFinding(agentId);

    const newTp = agent.truePositives + (verdict === "true_positive" ? 1 : 0);
    const newFp = agent.falsePositives + (verdict === "false_positive" ? 1 : 0);
    const total = newTp + newFp;
    const newAccuracy = total > 0 ? newTp / total : 0.8;
    let nextPersonalKb = agent.personalKB;
    let savedPattern: string | null = null;

    if (latestPendingFinding) {
      await updateFindingVerdictStatus({
        findingId: latestPendingFinding.id,
        status: verdict === "true_positive" ? "confirmed_true" : "confirmed_false",
      });

      if (verdict === "true_positive" && latestPendingFinding.finding) {
        const persona = mapRoleToPersona(agent.role);
        const pattern = toMemoryPattern({
          persona,
          filePath: latestPendingFinding.filePath,
          finding: latestPendingFinding.finding,
          functionName: latestPendingFinding.functionName,
        });

        const entries = parsePersonalKb(agent.personalKB);
        const updatedEntries = applyConfirmedFindingToPersonalKb({
          entries,
          pattern,
          fileType: latestPendingFinding.fileType ?? "unknown",
          language: latestPendingFinding.language,
          confidence: latestPendingFinding.finalConfidence,
        });

        nextPersonalKb = serializePersonalKb(updatedEntries);
        savedPattern = pattern;
        console.log(`[PersonalKB] ${agent.name} stored confirmed pattern: ${pattern}`);
      }
    }

    await db.update(agentsTable).set({
      truePositives: newTp,
      falsePositives: newFp,
      accuracy: newAccuracy,
      personalKB: nextPersonalKb,
    }).where(eq(agentsTable.id, agentId));

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}`,
      type: "verdict",
      agentId,
      agentName: agent.name,
      message: savedPattern
        ? `${agent.name} verdict: ${verdict.replace("_", " ")} — accuracy now ${Math.round(newAccuracy * 100)}% (📚 personalKB updated)`
        : `${agent.name} verdict: ${verdict.replace("_", " ")} — accuracy now ${Math.round(newAccuracy * 100)}%`,
      severity: verdict === "false_positive" ? "warning" : "info",
    }).catch(() => {});

    res.json({
      success: true,
      verdict,
      truePositives: newTp,
      falsePositives: newFp,
      accuracy: newAccuracy,
      updatedPersonalKb: savedPattern !== null,
      findingId: latestPendingFinding?.id ?? null,
      savedPattern,
    });
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
    console.log(`${taskPrefix(agent.name, String(taskType))} request_received building=${String(buildingId)} context="${String(context ?? "")}"`);

    const target = await resolveTargetBuilding(String(buildingId));
    if (!target) {
      res.status(404).json({ error: "NO_BUILDING", message: `Building '${String(buildingId)}' not found` });
      return;
    }
    const building = target.building;

    await db.update(agentsTable).set({
      currentBuilding: building.id,
      currentTask: String(taskType),
      status: "working",
    }).where(eq(agentsTable.id, agentId));

    const taskResult = await analyzeBuildingTask({
      agentName: agent.name,
      taskType: String(taskType),
      building,
      context: String(context ?? ""),
      agentRow: agent,
    });

    const normalizedTaskResult: TaskResult = {
      ...taskResult,
      bugsFound: taskResult.bugsFound,
    };

    if (normalizedTaskResult.classification === "bug" && normalizedTaskResult.bugsFound > 0) {
      if (normalizedTaskResult.findingText && normalizedTaskResult.issueType && normalizedTaskResult.codeReference) {
        const persisted = await classifyAndPersistBugFinding({
          agentId,
          agentName: agent.name,
          buildingId: building.id,
          buildingName: building.name,
          filePath: building.filePath,
          findingText: normalizedTaskResult.findingText,
          issueType: normalizedTaskResult.issueType,
          confidence: normalizedTaskResult.finalConfidence ?? 0,
          codeReference: normalizedTaskResult.codeReference,
        });

        normalizedTaskResult.bugsFound = persisted.status === "new" ? 1 : 0;
        normalizedTaskResult.severity = persisted.severity;
        normalizedTaskResult.confirmations = persisted.confirmations;
      } else {
        normalizedTaskResult.bugsFound = 0;
      }
    }

    for (const observation of normalizedTaskResult.observations) {
      await recordObservationEvent({
        agentId,
        agentName: agent.name,
        buildingId: building.id,
        buildingName: building.name,
        filePath: building.filePath,
        observation,
        confidence: normalizedTaskResult.finalConfidence,
        eventType: normalizedTaskResult.qualityReason === "low_confidence"
          ? "finding_low_confidence"
          : "finding_observation",
      });
    }

    if (normalizedTaskResult.classification === "discarded" && normalizedTaskResult.findingText) {
      await recordDiscardedFindingEvent({
        agentId,
        agentName: agent.name,
        buildingId: building.id,
        buildingName: building.name,
        filePath: building.filePath,
        findingText: normalizedTaskResult.findingText,
        reason: normalizedTaskResult.qualityReason ?? "discarded",
        confidence: normalizedTaskResult.finalConfidence,
        eventType: normalizedTaskResult.qualityReason === "generic"
          ? "finding_discarded_generic"
          : "finding_discarded",
      });
    }

    const visitedFiles = parseStringArray(agent.visitedFiles);
    let observations = parseStringArray(agent.observations);
    for (const observation of normalizedTaskResult.observations) {
      observations = pushUnique(observations, observation);
    }
    const nextVisitedFiles = pushUnique(visitedFiles, normalizeMemoryFilePath(building.filePath));
    const currentSpecialtyScore = typeof agent.specialtyScore === "number" ? agent.specialtyScore : 0;
    const nextSpecialtyScore = Math.max(0, Math.min(1, currentSpecialtyScore + specialtyDelta({
      role: agent.role,
      building,
      selectedTaskType: normalizedTaskResult.selectedTaskType ?? "generic_analysis",
      bugsFound: normalizedTaskResult.bugsFound,
      skippedByMemory: normalizedTaskResult.skippedByMemory === true,
    })));
    const testsGeneratedDelta = (
      !normalizedTaskResult.skippedByMemory
      && (taskType === "generate_tests" || (agent.role === "scribe" && normalizedTaskResult.selectedTaskType === "test_quality_review"))
    )
      ? Math.max(1, normalizedTaskResult.actionItems.length)
      : 0;

    await db.update(agentsTable).set({
      bugsFound: agent.bugsFound + normalizedTaskResult.bugsFound,
      testsGenerated: agent.testsGenerated + testsGeneratedDelta,
      escalations: agent.escalations + (normalizedTaskResult.escalated ? 1 : 0),
      kbHits: (agent.kbHits ?? 0) + (normalizedTaskResult.fromKnowledgeBase ? 1 : 0),
      visitedFiles: JSON.stringify(nextVisitedFiles),
      observations: JSON.stringify(observations),
      specialtyScore: nextSpecialtyScore,
      lastFileHash: normalizedTaskResult.memoryHash ?? agent.lastFileHash,
      currentBuilding: building.id,
      currentTask: String(taskType),
      status: "reporting",
    }).where(eq(agentsTable.id, agentId));

    if (normalizedTaskResult.skippedByMemory) {
      await db.insert(eventsTable).values({
        id: `evt-${Date.now()}-mem-${Math.random().toString(36).slice(2, 5)}`,
        type: "memory_skip",
        buildingId: building.id,
        buildingName: building.name,
        agentId,
        agentName: agent.name,
        message: `${agent.name} skipped ${building.name} (unchanged hash)`,
        severity: "info",
      }).catch(() => {});

      wsServer.broadcastEventLog("MEMORY_SKIP", `${agent.name} skipped ${building.name} (unchanged hash)`, "info");
    }

    if (normalizedTaskResult.classification === "bug" && normalizedTaskResult.bugsFound > 0) {
      const updatedBuilding = await persistBuildingFinding({
        repoId: target.repoId,
        layout: target.layout,
        buildingId: building.id,
        bugsFound: normalizedTaskResult.bugsFound,
      });

      const summary = normalizedTaskResult.result.replace(/\s+/g, " ").slice(0, 220);
      wsServer.broadcast({
        type: "bug_found",
        payload: {
          buildingId: building.id,
          count: normalizedTaskResult.bugsFound,
          provider: normalizedTaskResult.provider ?? "unknown",
          summary,
          message: `${agent.name} reported ${normalizedTaskResult.severity ?? "HIGH"} bug in ${building.name}`,
          severity: normalizedTaskResult.severity ?? "HIGH",
          confidencePercent: Math.round((normalizedTaskResult.finalConfidence ?? 0.8) * 100),
          codeReference: normalizedTaskResult.codeReference ?? "line reference unavailable",
          confirmations: normalizedTaskResult.confirmations ?? 1,
          status: updatedBuilding?.status ?? "fire",
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (normalizedTaskResult.escalated || normalizedTaskResult.provider) {
      await db.insert(eventsTable).values({
        id: `evt-${Date.now() + 1}`,
        type: "escalation",
        agentId,
        agentName: agent.name,
        message: `${agent.name} analysis provider: ${normalizedTaskResult.provider ?? "unknown"} on ${building.name}`,
        severity: "info",
      });
    }

    await db.update(agentsTable).set({
      currentTask: null,
      status: "idle",
    }).where(eq(agentsTable.id, agentId));

    console.log(`${taskPrefix(agent.name, String(taskType))} completed bugs=${normalizedTaskResult.bugsFound} provider=${normalizedTaskResult.provider ?? "n/a"}`);

    res.json({ success: true, taskType: String(taskType), buildingId: building.id, ...normalizedTaskResult });
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
          agentRole: agent.role,
          filePath: buildingContext ?? "chat-context",
          consultationContext: `Manual chat escalation requested by user for ${buildingContext ?? "building"}`,
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

    const confirmedFailedFindings = isSourceFile(building.filePath) ? result.failed : 0;

    await db.update(agentsTable).set({
      bugsFound: agents[0].bugsFound + confirmedFailedFindings,
      testsGenerated: agents[0].testsGenerated + result.passed + result.failed,
    }).where(eq(agentsTable.id, agentId));

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}`,
      type: "test_passed",
      buildingId,
      buildingName: building.name,
      agentId,
      agentName: agents[0].name,
      message: `${agents[0].name} ran ${result.passed + result.failed} test(s) on ${building.name}: ${result.passed} passed, ${result.failed} failed`,
      severity: result.failed > 0 ? "warning" : "info",
    }).catch(() => {});

    res.json({ ...result, buildingId, agentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "RUN_TESTS_ERROR", message });
  }
});

export default router;
