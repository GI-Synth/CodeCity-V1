import express from "express";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type QueryCacheState = {
  queryEmbeddingHits: number;
  queryEmbeddingMisses: number;
  queryResultHits: number;
  queryResultMisses: number;
};

const queryCacheState: QueryCacheState = {
  queryEmbeddingHits: 0,
  queryEmbeddingMisses: 0,
  queryResultHits: 0,
  queryResultMisses: 0,
};

const seenQueries = new Set<string>();

vi.mock("../src/lib/vectorSearch", () => ({
  getVectorCacheSize: () => 7,
  getQueryCacheStats: () => ({
    queryEmbeddingEntries: seenQueries.size,
    queryResultEntries: seenQueries.size,
    knowledgeDataVersion: 1,
    ...queryCacheState,
  }),
  hybridSearch: async (query: string) => {
    const key = query.toLowerCase().trim();
    if (seenQueries.has(key)) {
      queryCacheState.queryEmbeddingHits += 1;
      queryCacheState.queryResultHits += 1;
      return [];
    }

    seenQueries.add(key);
    queryCacheState.queryEmbeddingMisses += 1;
    queryCacheState.queryResultMisses += 1;
    return [];
  },
}));

vi.mock("../src/lib/sessionStats", () => ({
  getKbSessionStats: () => ({
    startedAt: new Date(0).toISOString(),
    totalEscalations: 0,
    kbHits: 0,
    kbMisses: 0,
    kbSaves: 0,
    vectorHits: 0,
    keywordHits: 0,
    similarityTotal: 0,
    similaritySamples: 0,
    kbHitRate: 0,
    avgSimilarity: 0,
  }),
}));

vi.mock("../src/lib/embeddings", () => ({
  isEmbeddingModelLoaded: () => true,
}));

vi.mock("../src/lib/embeddingQueue", () => ({
  getEmbeddingQueueStats: () => ({
    enabled: true,
    batchSize: 8,
    maxWaitMs: 250,
    pending: 0,
    inflight: 0,
    completed: 0,
    failed: 0,
    dropped: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    lastError: null,
    lastProcessedAt: null,
  }),
}));

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
  const body = await response.json();
  return {
    status: response.status,
    body,
  };
}

beforeEach(() => {
  seenQueries.clear();
  queryCacheState.queryEmbeddingHits = 0;
  queryCacheState.queryEmbeddingMisses = 0;
  queryCacheState.queryResultHits = 0;
  queryCacheState.queryResultMisses = 0;
});

beforeAll(async () => {
  const { default: knowledgeRouter } = await import("../src/routes/knowledge");

  const app = express();
  app.use("/api/knowledge", knowledgeRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start knowledge session-stats test server");
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

describe("knowledge session-stats queryCache trend", () => {
  it("reflects increasing hit/miss counters after repeated hybrid-search traffic", async () => {
    const first = await getJson("/api/knowledge/session-stats");
    expect(first.status).toBe(200);

    const firstPayload = asObject(first.body);
    const firstQueryCache = asObject(firstPayload.queryCache);
    expect(firstQueryCache.queryResultHits).toBe(0);
    expect(firstQueryCache.queryResultMisses).toBe(0);

    const vectorSearch = await import("../src/lib/vectorSearch") as {
      hybridSearch: (query: string) => Promise<unknown[]>;
    };

    await vectorSearch.hybridSearch("auth timeout");
    await vectorSearch.hybridSearch("auth timeout");
    await vectorSearch.hybridSearch("input validation");
    await vectorSearch.hybridSearch("input validation");

    const second = await getJson("/api/knowledge/session-stats");
    expect(second.status).toBe(200);

    const secondPayload = asObject(second.body);
    const secondQueryCache = asObject(secondPayload.queryCache);

    const resultHits = Number(secondQueryCache.queryResultHits ?? NaN);
    const resultMisses = Number(secondQueryCache.queryResultMisses ?? NaN);
    const embeddingHits = Number(secondQueryCache.queryEmbeddingHits ?? NaN);
    const embeddingMisses = Number(secondQueryCache.queryEmbeddingMisses ?? NaN);

    expect(resultHits).toBe(2);
    expect(resultMisses).toBe(2);
    expect(embeddingHits).toBe(2);
    expect(embeddingMisses).toBe(2);

    const totalResultLookups = resultHits + resultMisses;
    const hitRate = totalResultLookups > 0 ? resultHits / totalResultLookups : 0;

    expect(totalResultLookups).toBe(4);
    expect(hitRate).toBe(0.5);
  });
});
