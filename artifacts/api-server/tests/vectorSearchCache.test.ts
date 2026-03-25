import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEmbed = vi.fn(async (_query: string) => [1, 0, 0]);
const mockCosineSimilarity = vi.fn(() => 0.92);

const sampleEntry = {
  id: 1,
  problemType: "async_without_error_handling",
  language: "typescript",
  framework: null,
  patternTags: JSON.stringify(["async", "error-handling"]),
  fileType: "source",
  question: "fetch url without error handling",
  contextHash: "ctx-1",
  codeSnippet: "const x = await fetch(url)",
  answer: "Wrap in try/catch",
  actionItems: JSON.stringify(["Add try/catch"]),
  confidence: "medium",
  provider: "test",
  useCount: 1,
  wasUseful: 1,
  producedBugs: 0,
  qualityScore: 0.7,
  domain: "general",
  embedding: JSON.stringify([1, 0, 0]),
  createdAt: new Date().toISOString(),
  lastUsed: null,
};

function createSelectQuery(rows = [sampleEntry]) {
  const query: {
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (onFulfilled?: (value: typeof rows) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
  } = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => rows),
    then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected),
  };

  return query;
}

const mockSelect = vi.fn(() => ({
  from: vi.fn(() => createSelectQuery()),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("../src/lib/embeddings", () => ({
  embed: mockEmbed,
  cosineSimilarity: mockCosineSimilarity,
}));

async function loadVectorSearchModule() {
  vi.resetModules();
  return await import("../src/lib/vectorSearch");
}

describe("vectorSearch cache observability", () => {
  beforeEach(() => {
    mockEmbed.mockClear();
    mockCosineSimilarity.mockClear();
    mockSelect.mockClear();
  });

  it("records miss then hit for hybrid result cache", async () => {
    const vectorSearch = await loadVectorSearchModule();
    vectorSearch.resetVectorSearchState();

    await vectorSearch.hybridSearch("fetch url", 3, { language: "typescript" });

    const firstStats = vectorSearch.getQueryCacheStats();
    expect(firstStats.queryResultMisses).toBe(1);
    expect(firstStats.queryResultHits).toBe(0);
    expect(firstStats.queryEmbeddingMisses).toBe(1);
    expect(firstStats.queryEmbeddingHits).toBe(0);
    expect(mockEmbed).toHaveBeenCalledTimes(1);

    await vectorSearch.hybridSearch("fetch url", 3, { language: "typescript" });

    const secondStats = vectorSearch.getQueryCacheStats();
    expect(secondStats.queryResultMisses).toBe(1);
    expect(secondStats.queryResultHits).toBe(1);
    expect(secondStats.queryEmbeddingMisses).toBe(1);
    expect(secondStats.queryEmbeddingHits).toBe(0);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it("invalidates result cache when preferred domains change", async () => {
    const vectorSearch = await loadVectorSearchModule();
    vectorSearch.resetVectorSearchState();

    await vectorSearch.hybridSearch("fetch url", 3, { language: "typescript" });
    vectorSearch.setPreferredDomains(["audio"]);
    await vectorSearch.hybridSearch("fetch url", 3, { language: "typescript" });

    const stats = vectorSearch.getQueryCacheStats();
    expect(stats.queryResultMisses).toBe(2);
    expect(stats.queryResultHits).toBe(0);
    expect(stats.queryEmbeddingMisses).toBe(1);
    expect(stats.queryEmbeddingHits).toBe(1);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it("invalidates result cache when knowledge data mutates", async () => {
    const vectorSearch = await loadVectorSearchModule();
    vectorSearch.resetVectorSearchState();

    await vectorSearch.hybridSearch("fetch url", 3, { language: "typescript" });
    vectorSearch.invalidateKnowledgeSearchCache();
    await vectorSearch.hybridSearch("fetch url", 3, { language: "typescript" });

    const stats = vectorSearch.getQueryCacheStats();
    expect(stats.queryResultMisses).toBe(2);
    expect(stats.queryResultHits).toBe(0);
    expect(stats.queryEmbeddingMisses).toBe(1);
    expect(stats.queryEmbeddingHits).toBe(1);
    expect(stats.knowledgeDataVersion).toBeGreaterThan(1);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });
});
