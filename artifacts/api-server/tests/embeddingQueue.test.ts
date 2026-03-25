import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEmbedBatch = vi.fn(async (texts: string[]) =>
  texts.map((_text, index) => {
    const vector = Array.from({ length: 384 }, () => 0);
    vector[0] = index + 1;
    return vector;
  })
);

const mockAddToCache = vi.fn();

const sampleRow = {
  id: 1,
  problemType: "test_generation",
  language: "typescript",
  framework: null,
  patternTags: JSON.stringify(["async"]),
  fileType: "source",
  question: "How to handle async errors?",
  contextHash: "ctx-embed-1",
  codeSnippet: "await fetch(url)",
  answer: "Use try/catch",
  actionItems: JSON.stringify(["Add try/catch"]),
  confidence: "0.8",
  provider: "test",
  domain: "general",
  embedding: null,
  useCount: 1,
  wasUseful: 1,
  producedBugs: 0,
  qualityScore: 0.7,
  createdAt: new Date().toISOString(),
  lastUsed: null,
};

const mockSelectWhere = vi.fn(async () => [sampleRow]);
const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
}));
const mockSelect = vi.fn(() => ({
  from: mockSelectFrom,
}));

const mockUpdateWhere = vi.fn(async () => undefined);
const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}));
const mockUpdate = vi.fn(() => ({
  set: mockUpdateSet,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}));

vi.mock("../src/lib/embeddings", () => ({
  embedBatch: mockEmbedBatch,
}));

vi.mock("../src/lib/vectorSearch", () => ({
  addToCache: mockAddToCache,
}));

async function loadEmbeddingQueueModule() {
  vi.resetModules();
  return await import("../src/lib/embeddingQueue");
}

describe("embeddingQueue", () => {
  beforeEach(() => {
    mockEmbedBatch.mockClear();
    mockAddToCache.mockClear();
    mockSelect.mockClear();
    mockSelectFrom.mockClear();
    mockSelectWhere.mockClear();
    mockUpdate.mockClear();
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();

    mockSelectWhere.mockResolvedValue([sampleRow]);
  });

  it("processes queued embeddings and updates cache", async () => {
    const queue = await loadEmbeddingQueueModule();
    queue.resetEmbeddingQueueForTests();

    const enqueued = queue.enqueueKnowledgeEmbedding({
      knowledgeId: 1,
      text: `${sampleRow.question} ${sampleRow.answer}`,
      reason: "test-insert",
    });

    expect(enqueued).toBe(true);

    const idle = await queue.waitForEmbeddingQueueIdle(3000);
    expect(idle).toBe(true);

    expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    expect(mockAddToCache).toHaveBeenCalledTimes(1);

    const stats = queue.getEmbeddingQueueStats();
    expect(stats.pending).toBe(0);
    expect(stats.inflight).toBe(0);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.dropped).toBe(0);
    expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("deduplicates queued work by knowledge id", async () => {
    const queue = await loadEmbeddingQueueModule();
    queue.resetEmbeddingQueueForTests();

    queue.enqueueKnowledgeEmbedding({
      knowledgeId: 1,
      text: "first text",
      reason: "first",
    });

    queue.enqueueKnowledgeEmbedding({
      knowledgeId: 1,
      text: "second text",
      reason: "second",
    });

    const idle = await queue.waitForEmbeddingQueueIdle(3000);
    expect(idle).toBe(true);

    expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockEmbedBatch.mock.calls[0]?.[0]).toEqual(["second text"]);
    expect(mockAddToCache).toHaveBeenCalledTimes(1);
  });

  it("drops queue items when embedding already exists", async () => {
    const queue = await loadEmbeddingQueueModule();
    queue.resetEmbeddingQueueForTests();

    mockSelectWhere.mockResolvedValueOnce([
      {
        ...sampleRow,
        embedding: JSON.stringify(Array.from({ length: 384 }, () => 0)),
      },
    ]);

    queue.enqueueKnowledgeEmbedding({
      knowledgeId: 1,
      text: "already embedded",
      reason: "skip",
      skipIfPresent: true,
    });

    const idle = await queue.waitForEmbeddingQueueIdle(3000);
    expect(idle).toBe(true);

    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockUpdateWhere).not.toHaveBeenCalled();
    expect(mockAddToCache).not.toHaveBeenCalled();

    const stats = queue.getEmbeddingQueueStats();
    expect(stats.dropped).toBeGreaterThan(0);
  });
});
