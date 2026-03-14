#!/usr/bin/env tsx
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type CheckResult = {
  name: string;
  ok: boolean;
  details: string;
};

type HealthResponse = {
  status: string;
};

type KnowledgeStatsResponse = {
  totalEntries: number;
  totalCacheHits: number;
};

type SpawnAgentResponse = {
  id: string;
  name: string;
  role: string;
};

type KnowledgeImportResponse = {
  success: boolean;
  imported: number;
  skipped: number;
  total: number;
};

type AgentChatResponse = {
  source?: string;
  message?: string;
  offerEscalation?: boolean;
};

type KnowledgeSearchResponse = {
  total: number;
  entries: Array<{ id: number }>;
};

type KbSessionStatsResponse = {
  kbHits: number;
  kbMisses: number;
  kbHitRate: number;
  totalEscalations: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const BASE_URL = process.env.VALIDATE_BASE_URL ?? "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 10000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path: string): string {
  const cleanedBase = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
  const cleanedPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanedBase}${cleanedPath}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${response.status}): ${raw.slice(0, 220)}`);
  }

  return (raw ? JSON.parse(raw) : {}) as T;
}

async function checkHealth(): Promise<boolean> {
  try {
    const data = await requestJson<HealthResponse>("/api/healthz");
    return data.status === "ok";
  } catch {
    return false;
  }
}

function resolveTargetPort(): string {
  const parsed = new URL(BASE_URL);
  if (parsed.port) return parsed.port;
  return parsed.protocol === "https:" ? "443" : "80";
}

function startApiServer(): { process: ChildProcess; startupLog: string[] } {
  const startupLog: string[] = [];
  const targetPort = resolveTargetPort();

  const child = spawn("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: targetPort,
      ENABLE_SIMULATION_LOOP: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const capture = (chunk: Buffer) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      startupLog.push(line);
      if (startupLog.length > 30) startupLog.shift();
    }
  };

  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  return { process: child, startupLog };
}

async function waitForHealth(maxWaitMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    if (await checkHealth()) return true;
    await sleep(500);
  }
  return false;
}

async function stopApiServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;

  child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 6000);

  try {
    await once(child, "exit");
  } catch {
    // Ignore shutdown race conditions.
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const checks: CheckResult[] = [];
  let spawnedServer: ChildProcess | null = null;
  let startupLog: string[] = [];

  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const validateLanguage = `validate_loop_${nonce}`;
  const validateContext = `validate-loop-${nonce}.ts`;
  const validateQuestion = `Validate loop ${nonce}: async logic awaits operations without try/catch and can produce unhandled promise rejections.`;

  let spawnedAgentId = "";

  const record = (name: string, ok: boolean, details: string) => {
    checks.push({ name, ok, details });
    const marker = ok ? "PASS" : "FAIL";
    console.log(`[${marker}] ${name} :: ${details}`);
  };

  try {
    const healthyBeforeStart = await checkHealth();
    if (!healthyBeforeStart) {
      const started = startApiServer();
      spawnedServer = started.process;
      startupLog = started.startupLog;

      const becameHealthy = await waitForHealth(45000);
      if (!becameHealthy) {
        throw new Error(`API did not become healthy in time. Recent server logs: ${startupLog.join(" | ")}`);
      }

      record("API bootstrap", true, "API server auto-started for validation run");
    } else {
      record("API bootstrap", true, "Reused existing API server instance");
    }

    const health = await requestJson<HealthResponse>("/api/healthz");
    if (health.status !== "ok") {
      throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
    }
    record("Health endpoint", true, "GET /api/healthz returned status=ok");

    const statsBefore = await requestJson<KnowledgeStatsResponse>("/api/knowledge/stats");
    record("Knowledge baseline", true, `entries=${statsBefore.totalEntries}, cacheHits=${statsBefore.totalCacheHits}`);

    const spawnedAgent = await requestJson<SpawnAgentResponse>("/api/agents/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "qa_inspector", targetBuilding: "validate-loop" }),
    });
    spawnedAgentId = spawnedAgent.id;
    record("Agent spawn", true, `spawned ${spawnedAgent.name} (${spawnedAgent.role})`);

    const imported = await requestJson<KnowledgeImportResponse>("/api/knowledge/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: [
          {
            problemType: "maintainability",
            language: validateLanguage,
            question: validateQuestion,
            answer: "Wrap awaited operations in try/catch and convert unknown failures to explicit errors.",
            confidence: "high",
            provider: "validate-loop",
            actionItems: ["Add try/catch", "Log context-rich errors", "Add rejection-path tests"],
            useCount: 0,
            wasUseful: 1,
            producedBugs: 0,
            qualityScore: 0.9,
          },
        ],
      }),
    });

    if (!imported.success || imported.imported < 1) {
      throw new Error(`Import did not succeed: ${JSON.stringify(imported)}`);
    }
    record("KB seed for validate", true, `imported=${imported.imported}, skipped=${imported.skipped}`);

    let intro = await requestJson<AgentChatResponse>(`/api/agents/${spawnedAgentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: validateQuestion,
        buildingContext: validateContext,
        buildingContent: "async function runTask() { return await fetchData(); }",
        buildingLanguage: validateLanguage,
      }),
    });

    if (!intro.offerEscalation) {
      intro = await requestJson<AgentChatResponse>(`/api/agents/${spawnedAgentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "I still feel uncertain; should we escalate this case?",
          buildingContext: validateContext,
          buildingContent: "async function runTask() { return await fetchData(); }",
          buildingLanguage: validateLanguage,
        }),
      });
    }

    if (!intro.offerEscalation) {
      throw new Error("Agent did not offer escalation after two attempts; cannot validate escalation loop.");
    }
    record("Escalation offer", true, "agent offered escalation in chat flow");

    const escalated = await requestJson<AgentChatResponse>(`/api/agents/${spawnedAgentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "yes escalate",
        buildingContext: validateContext,
        buildingContent: "async function runTask() { return await fetchData(); }",
        buildingLanguage: validateLanguage,
      }),
    });

    if (escalated.source !== "knowledge_base") {
      throw new Error(`Expected knowledge_base escalation source, got ${String(escalated.source ?? "unknown")}`);
    }
    record("Escalation resolve", true, `source=${escalated.source}`);

    const statsAfter = await requestJson<KnowledgeStatsResponse>("/api/knowledge/stats");
    if (statsAfter.totalCacheHits <= statsBefore.totalCacheHits) {
      throw new Error(`Cache hits did not increase (${statsBefore.totalCacheHits} -> ${statsAfter.totalCacheHits})`);
    }
    record(
      "Knowledge hit confirmed",
      true,
      `cacheHits ${statsBefore.totalCacheHits} -> ${statsAfter.totalCacheHits}`
    );

    const sessionStats = await requestJson<KbSessionStatsResponse>("/api/knowledge/session-stats");
    if (sessionStats.kbHits < 1 || sessionStats.kbHitRate <= 0) {
      throw new Error(`Session stats did not reflect KB hit: ${JSON.stringify(sessionStats)}`);
    }
    record(
      "Session telemetry",
      true,
      `hits=${sessionStats.kbHits}, misses=${sessionStats.kbMisses}, hitRate=${Math.round(sessionStats.kbHitRate * 100)}%`
    );

    const search = await requestJson<KnowledgeSearchResponse>(`/api/knowledge/search?q=${encodeURIComponent(nonce)}&limit=20`);
    if (search.total < 1 || search.entries.length < 1) {
      throw new Error("Could not find validate-loop KB entry for cleanup.");
    }
    record("KB entry lookup", true, `search matched ${search.total} entry(ies)`);

    for (const entry of search.entries) {
      await requestJson<{ success: boolean }>(`/api/knowledge/${entry.id}`, { method: "DELETE" });
    }
    record("Cleanup", true, `removed ${search.entries.length} validate-loop KB entry(ies)`);

    await requestJson<{ success: boolean }>(`/api/agents/${spawnedAgentId}/retire`, { method: "POST" });
    record("Agent cleanup", true, `retired ${spawnedAgentId}`);

    console.log("\nVALIDATE LOOP RESULT: PASS");
    console.log(`Checks passed: ${checks.length}/${checks.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record("Validation failure", false, message);

    if (spawnedAgentId) {
      try {
        await requestJson<{ success: boolean }>(`/api/agents/${spawnedAgentId}/retire`, { method: "POST" });
      } catch {
        // Best effort cleanup.
      }
    }

    console.error("\nVALIDATE LOOP RESULT: FAIL");
    console.error(`Reason: ${message}`);
    process.exitCode = 1;
  } finally {
    if (spawnedServer) {
      await stopApiServer(spawnedServer);
      console.log("[INFO] Stopped API server started by validate-loop.");
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unexpected validate-loop failure: ${message}`);
  process.exit(1);
});
