import http from "node:http";
import { ensureRuntimeDbMigrations } from "@workspace/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: http.Server;
let baseUrl = "";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Expected object JSON response");
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();

  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Expected JSON from ${path}: ${detail}`);
    }
  }

  return {
    status: response.status,
    body: parsed,
  };
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await ensureRuntimeDbMigrations();
  const { default: app } = await import("../src/app");

  server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start integration test server");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe("API route integration", () => {
  it("returns healthz payload", async () => {
    const { status, body } = await getJson("/api/healthz");

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("returns orchestrator status contract", async () => {
    const { status, body } = await getJson("/api/orchestrator/status");

    expect(status).toBe(200);

    const payload = asObject(body);
    expect(typeof payload.model).toBe("string");
    expect(payload.nextRunInMs === null || typeof payload.nextRunInMs === "number").toBe(true);
    expect(payload.lastDirective === null || typeof payload.lastDirective === "object").toBe(true);
  });

  it("returns city health or no-active-repo response", async () => {
    const { status, body } = await getJson("/api/city/health");

    if (status === 200) {
      const payload = asObject(body);
      const breakdown = asObject(payload.breakdown);

      expect(typeof payload.score).toBe("number");
      expect(typeof payload.season).toBe("string");
      expect(typeof breakdown.testCoverage).toBe("number");
      expect(typeof breakdown.codeQuality).toBe("number");
      return;
    }

    expect(status).toBe(404);
    const payload = asObject(body);
    expect(payload.error).toBe("NO_ACTIVE_REPO");
  });

  it("returns agent leaderboard payload", async () => {
    const { status, body } = await getJson("/api/agents/leaderboard");

    expect(status).toBe(200);
    const payload = asObject(body);

    expect(Array.isArray(payload.agents)).toBe(true);

    const agents = payload.agents as Array<Record<string, unknown>>;
    if (agents.length > 0) {
      expect(typeof agents[0]?.id).toBe("string");
      expect(typeof agents[0]?.name).toBe("string");
      expect(typeof agents[0]?.bugsFound).toBe("number");
    }
  });

  it("returns ollama connection diagnostics", async () => {
    const { status, body } = await getJson("/api/ollama/test-connection");

    expect(status).toBe(200);
    const payload = asObject(body);

    expect(typeof payload.host).toBe("string");
    expect(typeof payload.reachable).toBe("boolean");
    expect(Array.isArray(payload.models)).toBe(true);
    expect(typeof payload.latencyMs).toBe("number");
    expect(typeof payload.recommendation).toBe("string");
  });

  it("returns knowledge session stats payload", async () => {
    const { status, body } = await getJson("/api/knowledge/session-stats");

    expect(status).toBe(200);
    const payload = asObject(body);
    const queryCache = asObject(payload.queryCache);
    const embeddingQueue = asObject(payload.embeddingQueue);

    expect(typeof payload.startedAt).toBe("string");
    expect(typeof payload.kbHits).toBe("number");
    expect(typeof payload.kbMisses).toBe("number");
    expect(typeof payload.kbHitRate).toBe("number");
    expect(typeof payload.vectorCacheSize).toBe("number");
    expect(typeof queryCache.queryEmbeddingEntries).toBe("number");
    expect(typeof queryCache.queryResultEntries).toBe("number");
    expect(typeof queryCache.queryEmbeddingHits).toBe("number");
    expect(typeof queryCache.queryEmbeddingMisses).toBe("number");
    expect(typeof queryCache.queryResultHits).toBe("number");
    expect(typeof queryCache.queryResultMisses).toBe("number");
    expect(typeof queryCache.knowledgeDataVersion).toBe("number");
    expect(typeof embeddingQueue.pending).toBe("number");
    expect(typeof embeddingQueue.inflight).toBe("number");
    expect(typeof embeddingQueue.completed).toBe("number");
    expect(typeof embeddingQueue.failed).toBe("number");
    expect(typeof embeddingQueue.dropped).toBe("number");
    expect(typeof embeddingQueue.avgLatencyMs).toBe("number");
    expect(typeof payload.modelLoaded).toBe("boolean");
  });

  it("returns metrics contract and history KPI payloads", async () => {
    const contractResponse = await getJson("/api/metrics/contract");
    expect(contractResponse.status).toBe(200);

    const contract = asObject(contractResponse.body);
    const metrics = asObject(contract.metrics);

    expect(typeof contract.version).toBe("string");
    expect(typeof asObject(metrics.predictionAccuracyScore).shortName).toBe("string");
    expect(typeof asObject(metrics.falseNegativeRate).shortName).toBe("string");
    expect(typeof asObject(metrics.confidenceCalibrationIndex).shortName).toBe("string");
    expect(typeof asObject(metrics.recommendationFixConversion).shortName).toBe("string");
    expect(typeof asObject(metrics.testGenerationEffectiveness).shortName).toBe("string");
    expect(typeof asObject(metrics.reinforcementCoverage).shortName).toBe("string");
    expect(typeof asObject(metrics.reinforcementNet).shortName).toBe("string");

    const historyResponse = await getJson("/api/metrics/history?hours=24");
    expect(historyResponse.status).toBe(200);

    const history = asObject(historyResponse.body);
    expect(typeof history.kpiContractVersion).toBe("string");
    expect(Array.isArray(history.snapshots)).toBe(true);
    expect(typeof history.count).toBe("number");

    const snapshots = history.snapshots as Array<Record<string, unknown>>;
    if (snapshots.length > 0) {
      const latest = snapshots[snapshots.length - 1] ?? {};
      expect(typeof latest.predictionAccuracyScore).toBe("number");
      expect(typeof latest.falseNegativeRate).toBe("number");
      expect(typeof latest.confidenceCalibrationIndex).toBe("number");
      expect(typeof latest.recommendationFixConversion).toBe("number");
      expect(typeof latest.testGenerationEffectiveness).toBe("number");
      expect(typeof latest.kpiSampleSize).toBe("number");
      expect(typeof latest.reinforcementAttempts).toBe("number");
      expect(typeof latest.reinforcementApplied).toBe("number");
      expect(typeof latest.reinforcementBoosts).toBe("number");
      expect(typeof latest.reinforcementDecays).toBe("number");
      expect(typeof latest.reinforcementNet).toBe("number");
      expect(typeof latest.reinforcementCoverage).toBe("number");
    }

    const reinforcementSummaryResponse = await getJson("/api/metrics/reinforcement-summary?hours=24");
    expect(reinforcementSummaryResponse.status).toBe(200);
    const reinforcementSummary = asObject(reinforcementSummaryResponse.body);
    const totals = asObject(reinforcementSummary.totals);
    const corruptionHandling = asObject(reinforcementSummary.corruptionHandling);

    expect(typeof reinforcementSummary.hours).toBe("number");
    expect(typeof totals.attempts).toBe("number");
    expect(typeof totals.applied).toBe("number");
    expect(typeof totals.boosts).toBe("number");
    expect(typeof totals.decays).toBe("number");
    expect(typeof corruptionHandling.knownCorruptRowCount).toBe("number");
    expect(typeof corruptionHandling.scanCorruptionSkips).toBe("number");
    expect(typeof corruptionHandling.rowUpdateCorruptionSkips).toBe("number");
    expect(typeof corruptionHandling.seedInsertCorruptionSkips).toBe("number");
    expect(typeof corruptionHandling.suppressedKnownCorruptRowSkips).toBe("number");
    expect(typeof corruptionHandling.repairAttempts).toBe("number");
    expect(typeof corruptionHandling.repairSuccesses).toBe("number");
    expect(typeof corruptionHandling.repairFailures).toBe("number");
    expect(Array.isArray(reinforcementSummary.topBoostPatterns)).toBe(true);
    expect(Array.isArray(reinforcementSummary.topDecayPatterns)).toBe(true);
    expect(Array.isArray(reinforcementSummary.topAgentDeltas)).toBe(true);

    const rolloutResponse = await getJson("/api/metrics/rollout-gates?hours=24");
    expect(rolloutResponse.status).toBe(200);
    const rolloutPayload = asObject(rolloutResponse.body);

    expect(typeof rolloutPayload.gateVersion).toBe("string");
    expect(Array.isArray(rolloutPayload.gates)).toBe(true);
  });
});
