import http from "http";
import app from "./app";
import { wsServer } from "./lib/wsServer";
import { startAgentLoop, clearAllAgentIntervals } from "./lib/agentEngine";
import { orchestrator } from "./lib/orchestrator";
import { validateEnv } from "./lib/envValidator";
import { writeMetricSnapshot } from "./routes/metrics";
import { db, ensureRuntimeDbMigrations } from "@workspace/db";
import { agentsTable, eventsTable, reposTable } from "@workspace/db/schema";
import { and, eq, like, or } from "drizzle-orm";
import { loadEnvFile } from "./lib/loadEnv";
import { embedExistingEntries } from "./lib/embeddings";
import { buildVectorCache } from "./lib/vectorSearch";
import { setPreferredDomains } from "./lib/vectorSearch";
import {
  cleanupNonSourceKnowledgeAndRecountBugs,
  hasMarkdownOrHtmlKnowledgeEntries,
  purgeStartupKnowledgeLanguages,
} from "./lib/knowledgeCleanup";
import { startConsoleLogAgent, stopConsoleLogAgent } from "./lib/consoleLogAgent";

const loadedEnvPath = loadEnvFile();
if (loadedEnvPath) {
  console.log(`[Env] Loaded .env from ${loadedEnvPath}`);
}

function isSimulationLoopEnabled(): boolean {
  const raw = process.env["ENABLE_SIMULATION_LOOP"];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

wsServer.initialize(server);

async function purgeLegacySimulationData(): Promise<void> {
  await db.delete(eventsTable).where(
    or(
      like(eventsTable.id, "evt-seed-%"),
      like(eventsTable.id, "evt-live-%"),
      eq(eventsTable.type, "task_complete"),
      and(eq(eventsTable.type, "escalation"), like(eventsTable.message, "%offered escalation%")),
      and(eq(eventsTable.type, "bug_found"), like(eventsTable.message, "%found%bug(s)%")),
    )
  );

  await db.update(agentsTable).set({
    status: "idle",
    currentBuilding: null,
    currentTask: null,
    bugsFound: 0,
    testsGenerated: 0,
    escalations: 0,
    truePositives: 0,
    falsePositives: 0,
    escalationCount: 0,
    kbHits: 0,
    visitedFiles: "[]",
    personalKB: "[]",
    observations: "[]",
    specialtyScore: 0,
    lastFileHash: null,
    totalTasksCompleted: 0,
    rank: "junior",
  });
}

async function restoreVectorDomainPreferences(): Promise<void> {
  const activeRepo = await db
    .select({ projectFingerprint: reposTable.projectFingerprint })
    .from(reposTable)
    .where(eq(reposTable.isActive, true))
    .limit(1);

  const stored = activeRepo[0]?.projectFingerprint;
  if (!stored) {
    setPreferredDomains(["general"]);
    return;
  }

  try {
    const fingerprint = JSON.parse(stored) as {
      type?: string;
      isAudioProject?: boolean;
      isPlugin?: boolean;
      relevantDomains?: string[];
    };

    const domains = Array.isArray(fingerprint.relevantDomains) && fingerprint.relevantDomains.length > 0
      ? fingerprint.relevantDomains
      : ["general"];

    setPreferredDomains(domains);

    if (fingerprint.isAudioProject || fingerprint.isPlugin) {
      const focused = domains.filter((domain) => domain !== "general").join(" + ") || "general";
      console.log(`[Fingerprint] ${fingerprint.type ?? "project"} detected, loading ${focused} KB domains`);
    }
  } catch {
    setPreferredDomains(["general"]);
  }
}

async function runStartupKnowledgeCleanup(): Promise<void> {
  const hasMarkupEntries = await hasMarkdownOrHtmlKnowledgeEntries();
  const startupRemoved = await purgeStartupKnowledgeLanguages();

  if (!hasMarkupEntries) {
    if (startupRemoved > 0) {
      console.log(`[KBCleanup] Startup language purge removed ${startupRemoved} entry(ies)`);
    }
    return;
  }

  const cleanup = await cleanupNonSourceKnowledgeAndRecountBugs();
  const totalRemoved = startupRemoved + cleanup.removed;
  console.log(`[KBCleanup] Startup cleanup removed=${totalRemoved} remaining=${cleanup.remaining} bugsFound=${cleanup.bugsFound}`);
}

async function startServer(): Promise<void> {
  await ensureRuntimeDbMigrations();
  await runStartupKnowledgeCleanup();
  await validateEnv();
  const simulationEnabled = isSimulationLoopEnabled();

  if (!simulationEnabled) {
    await purgeLegacySimulationData();
    console.log("[DataCleanup] Removed legacy simulation artifacts for real-data mode");
  }

  await restoreVectorDomainPreferences();

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);

    if (simulationEnabled) {
      console.log("[AgentLoop] ENABLE_SIMULATION_LOOP=true, starting autonomous loop");
      startAgentLoop();
      orchestrator.start();
      startConsoleLogAgent();
      console.log("[Orchestrator] Started city strategy loop");
    } else {
      console.log("[AgentLoop] Disabled by default (set ENABLE_SIMULATION_LOOP=true to enable)");
    }

    setInterval(() => { writeMetricSnapshot().catch(() => {}); }, 30_000);
    setTimeout(() => { writeMetricSnapshot().catch(() => {}); }, 5_000);

    // Run semantic index prep in the background to avoid delaying startup.
    setTimeout(() => {
      void (async () => {
        try {
          await embedExistingEntries();
          await buildVectorCache();
        } catch (error) {
          console.warn("[Embeddings] Background embed failed:", error);
        }
      })();
    }, 3_000);
  });
}

function shutdown(signal: string): void {
  console.log(`\nSoftware City shutting down cleanly (${signal})`);
  orchestrator.stop();
  stopConsoleLogAgent();
  clearAllAgentIntervals();
  wsServer.closeAll();
  server.close(() => {
    console.log("HTTP server closed. Goodbye.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
