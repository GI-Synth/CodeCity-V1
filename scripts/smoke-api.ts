#!/usr/bin/env tsx

type CheckResult = {
  name: string;
  ok: boolean;
  details: string;
};

const API_BASE = process.env.API_BASE?.trim() || "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 8_000;
const LATENCY_THRESHOLD_MS = Number(process.env.SMOKE_LATENCY_THRESHOLD_MS?.trim() || "3000");
const QUERY_CACHE_MIN_HIT_RATE = Number(process.env.SMOKE_QUERY_CACHE_MIN_HIT_RATE?.trim() || "0.10");
const QUERY_CACHE_MIN_SAMPLES = Number(process.env.SMOKE_QUERY_CACHE_MIN_SAMPLES?.trim() || "5");
const EMBED_QUEUE_MAX_PENDING = Number(process.env.SMOKE_EMBED_QUEUE_MAX_PENDING?.trim() || "500");
const REQUIRED_KPI_KEYS = [
  "predictionAccuracyScore",
  "falseNegativeRate",
  "confidenceCalibrationIndex",
  "recommendationFixConversion",
  "testGenerationEffectiveness",
] as const;

async function fetchJson(path: string): Promise<{ data: unknown; durationMs: number }> {
  const url = `${API_BASE}${path}`;
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${body}`.trim());
  }

  return {
    data: await response.json(),
    durationMs,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const { data, durationMs } = await fetchJson("/api/healthz");
    const health = asObject(data);
    const status = String(health.status ?? "");
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;
    results.push({
      name: "healthz",
      ok: status === "ok" && latencyOk,
      details: `${status || "missing status"}; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "healthz", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/knowledge/stats");
    const stats = asObject(data);
    const totalEntries = Number(stats.totalEntries ?? NaN);
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;
    results.push({
      name: "knowledge.stats",
      ok: Number.isFinite(totalEntries) && totalEntries >= 0 && latencyOk,
      details: `totalEntries=${Number.isFinite(totalEntries) ? totalEntries : "invalid"}; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "knowledge.stats", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/knowledge/session-stats");
    const sessionStats = asObject(data);
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;

    const kbHitRate = Number(sessionStats.kbHitRate ?? NaN);
    const withinRange = Number.isFinite(kbHitRate) && kbHitRate >= 0 && kbHitRate <= 1;

    results.push({
      name: "knowledge.session-stats",
      ok: withinRange && latencyOk,
      details: `kbHitRate=${withinRange ? kbHitRate.toFixed(4) : "invalid"}; latency=${durationMs}ms`,
    });

    const queryCache = asObject(sessionStats.queryCache);
    const resultHits = Number(queryCache.queryResultHits ?? NaN);
    const resultMisses = Number(queryCache.queryResultMisses ?? NaN);
    const embeddingHits = Number(queryCache.queryEmbeddingHits ?? NaN);
    const embeddingMisses = Number(queryCache.queryEmbeddingMisses ?? NaN);

    const countsValid = [resultHits, resultMisses, embeddingHits, embeddingMisses].every(
      (value) => Number.isFinite(value) && value >= 0,
    );

    const resultLookups = resultHits + resultMisses;
    const resultHitRate = resultLookups > 0 ? resultHits / resultLookups : 0;
    const enoughSamples = resultLookups >= QUERY_CACHE_MIN_SAMPLES;
    const hitRateOk = !enoughSamples || resultHitRate >= QUERY_CACHE_MIN_HIT_RATE;

    const sampleDetail = enoughSamples
      ? `hitRate>=${QUERY_CACHE_MIN_HIT_RATE.toFixed(2)}`
      : `insufficient_samples(<${QUERY_CACHE_MIN_SAMPLES})`;

    results.push({
      name: "knowledge.query-cache",
      ok: countsValid && hitRateOk,
      details: `resultHits=${Number.isFinite(resultHits) ? resultHits : "invalid"}, resultMisses=${Number.isFinite(resultMisses) ? resultMisses : "invalid"}, hitRate=${Number.isFinite(resultHitRate) ? resultHitRate.toFixed(4) : "invalid"}, ${sampleDetail}`,
    });

    const embeddingQueue = asObject(sessionStats.embeddingQueue);
    const queuePending = Number(embeddingQueue.pending ?? NaN);
    const queueInflight = Number(embeddingQueue.inflight ?? NaN);
    const queueCompleted = Number(embeddingQueue.completed ?? NaN);
    const queueFailed = Number(embeddingQueue.failed ?? NaN);
    const queueDropped = Number(embeddingQueue.dropped ?? NaN);
    const queueAvgLatency = Number(embeddingQueue.avgLatencyMs ?? NaN);

    const queueCountsValid = [queuePending, queueInflight, queueCompleted, queueFailed, queueDropped, queueAvgLatency]
      .every((value) => Number.isFinite(value) && value >= 0);

    const queueDepthOk = queuePending <= EMBED_QUEUE_MAX_PENDING;

    results.push({
      name: "knowledge.embedding-queue",
      ok: queueCountsValid && queueDepthOk,
      details: `pending=${Number.isFinite(queuePending) ? queuePending : "invalid"}, inflight=${Number.isFinite(queueInflight) ? queueInflight : "invalid"}, completed=${Number.isFinite(queueCompleted) ? queueCompleted : "invalid"}, failed=${Number.isFinite(queueFailed) ? queueFailed : "invalid"}, avgLatencyMs=${Number.isFinite(queueAvgLatency) ? queueAvgLatency.toFixed(1) : "invalid"}, pending<=${EMBED_QUEUE_MAX_PENDING}`,
    });
  } catch (error) {
    results.push({ name: "knowledge.session-stats", ok: false, details: String(error) });
    results.push({ name: "knowledge.query-cache", ok: false, details: String(error) });
    results.push({ name: "knowledge.embedding-queue", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/orchestrator/status");
    const orchestrator = asObject(data);
    const model = String(orchestrator.model ?? "").trim();
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;
    results.push({
      name: "orchestrator.status",
      ok: model.length > 0 && latencyOk,
      details: `${model || "missing model"}; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "orchestrator.status", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/metrics/contract");
    const payload = asObject(data);
    const version = String(payload.version ?? "").trim();
    const metrics = asObject(payload.metrics);
    const missing = REQUIRED_KPI_KEYS.filter((key) => {
      const metric = asObject(metrics[key]);
      return typeof metric.shortName !== "string" || String(metric.shortName).trim().length === 0;
    });
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;

    results.push({
      name: "metrics.contract",
      ok: version.length > 0 && missing.length === 0 && latencyOk,
      details: `version=${version || "missing"}; missing=${missing.length > 0 ? missing.join(",") : "none"}; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "metrics.contract", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/metrics/history?hours=24");
    const payload = asObject(data);
    const snapshots = asArray(payload.snapshots);
    const count = Number(payload.count ?? snapshots.length);
    const kpiContractVersion = String(payload.kpiContractVersion ?? "").trim();

    let latestSnapshotOk = true;
    let latestDetail = "none";

    if (snapshots.length > 0) {
      const latest = asObject(snapshots[snapshots.length - 1]);
      const requiredNumericFields = [
        "predictionAccuracyScore",
        "falseNegativeRate",
        "confidenceCalibrationIndex",
        "recommendationFixConversion",
        "testGenerationEffectiveness",
        "kpiSampleSize",
      ] as const;

      const badFields = requiredNumericFields.filter((field) => {
        const value = Number(latest[field] ?? NaN);
        return !Number.isFinite(value) || value < 0;
      });

      latestSnapshotOk = badFields.length === 0;
      latestDetail = badFields.length > 0 ? `invalid=${badFields.join(",")}` : "valid";
    }

    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;
    const countOk = Number.isFinite(count) && count >= 0;

    results.push({
      name: "metrics.history",
      ok: countOk && kpiContractVersion.length > 0 && latestSnapshotOk && latencyOk,
      details: `count=${countOk ? count : "invalid"}; contract=${kpiContractVersion || "missing"}; latest=${latestDetail}; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "metrics.history", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/city/health");
    const cityHealth = asObject(data);
    const score = Number(cityHealth.score ?? NaN);
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;
    results.push({
      name: "city.health",
      ok: Number.isFinite(score) && latencyOk,
      details: `score=${Number.isFinite(score) ? score : "invalid"}; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "city.health", ok: false, details: String(error) });
  }

  try {
    const { data, durationMs } = await fetchJson("/api/agents/leaderboard");
    const leaderboard = asObject(data);
    const agents = asArray(leaderboard.agents);
    const topAgent = asObject(agents[0]);
    const topAgentName = String(topAgent.name ?? "unknown");
    const latencyOk = durationMs <= LATENCY_THRESHOLD_MS;
    results.push({
      name: "agents.leaderboard",
      ok: agents.length > 0 && latencyOk,
      details: agents.length > 0 ? `agents=${agents.length}, top=${topAgentName}; latency=${durationMs}ms` : `no agents; latency=${durationMs}ms`,
    });
  } catch (error) {
    results.push({ name: "agents.leaderboard", ok: false, details: String(error) });
  }

  return results;
}

async function main(): Promise<void> {
  console.log(`Smoke API checks against ${API_BASE}`);
  const results = await runChecks();

  for (const result of results) {
    const icon = result.ok ? "[ok]" : "[fail]";
    console.log(`${icon} ${result.name} - ${result.details}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`Smoke checks failed: ${failed.length}/${results.length}`);
    process.exit(1);
  }

  console.log(`Smoke checks passed: ${results.length}/${results.length}`);
}

main().catch((error) => {
  console.error("Smoke check fatal error:", error);
  process.exit(1);
});
