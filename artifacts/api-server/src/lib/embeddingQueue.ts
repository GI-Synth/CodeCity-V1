import { db } from "@workspace/db";
import { knowledgeTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { embedBatch } from "./embeddings";
import { addToCache } from "./vectorSearch";

const EMBEDDING_QUEUE_BATCH_SIZE = Math.max(
  1,
  Number(process.env["EMBED_QUEUE_BATCH_SIZE"]?.trim() || "8"),
);
const EMBEDDING_QUEUE_MAX_WAIT_MS = Math.max(
  25,
  Number(process.env["EMBED_QUEUE_MAX_WAIT_MS"]?.trim() || "250"),
);

interface EmbeddingQueueItem {
  knowledgeId: number;
  text: string;
  enqueuedAt: number;
  skipIfPresent: boolean;
  reason: string;
}

export interface EmbeddingQueueStats {
  enabled: boolean;
  batchSize: number;
  maxWaitMs: number;
  pending: number;
  inflight: number;
  completed: number;
  failed: number;
  dropped: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  lastError: string | null;
  lastProcessedAt: string | null;
}

const pendingById = new Map<number, EmbeddingQueueItem>();
const pendingOrder: number[] = [];

let inflight = 0;
let processing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const queueMetrics = {
  completed: 0,
  failed: 0,
  dropped: 0,
  latencyTotalMs: 0,
  latencySamples: 0,
  lastLatencyMs: 0,
  lastError: null as string | null,
  lastProcessedAt: null as string | null,
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 512);
}

function setLastError(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  queueMetrics.lastError = detail.slice(0, 260);
}

function scheduleQueueProcessing(): void {
  if (processing || flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void processEmbeddingQueue();
  }, EMBEDDING_QUEUE_MAX_WAIT_MS);
}

function recordLatency(item: EmbeddingQueueItem): void {
  const latencyMs = Math.max(0, Date.now() - item.enqueuedAt);
  queueMetrics.lastLatencyMs = latencyMs;
  queueMetrics.latencyTotalMs += latencyMs;
  queueMetrics.latencySamples += 1;
}

function pickNextBatchIds(): number[] {
  const ids: number[] = [];

  while (ids.length < EMBEDDING_QUEUE_BATCH_SIZE && pendingOrder.length > 0) {
    const id = pendingOrder.shift();
    if (typeof id !== "number") continue;
    if (!pendingById.has(id)) continue;
    ids.push(id);
  }

  return ids;
}

function buildUpdatedEntry(
  row: typeof knowledgeTable.$inferSelect,
  embeddingJson: string,
): typeof knowledgeTable.$inferSelect {
  return {
    ...row,
    embedding: embeddingJson,
  };
}

async function processEmbeddingBatch(batchItems: EmbeddingQueueItem[]): Promise<void> {
  if (batchItems.length === 0) return;

  const ids = batchItems.map((item) => item.knowledgeId);
  const rows = await db
    .select()
    .from(knowledgeTable)
    .where(inArray(knowledgeTable.id, ids));

  const rowById = new Map(rows.map((row) => [row.id, row]));

  const toEmbed: Array<{
    item: EmbeddingQueueItem;
    row: typeof knowledgeTable.$inferSelect;
    text: string;
  }> = [];

  for (const item of batchItems) {
    const row = rowById.get(item.knowledgeId);
    if (!row) {
      queueMetrics.dropped += 1;
      continue;
    }

    if (item.skipIfPresent && row.embedding) {
      queueMetrics.dropped += 1;
      continue;
    }

    const text = normalizeText(item.text) || normalizeText(`${row.question} ${row.answer}`);
    if (!text) {
      queueMetrics.dropped += 1;
      continue;
    }

    toEmbed.push({ item, row, text });
  }

  if (toEmbed.length === 0) return;

  const vectors = await embedBatch(toEmbed.map((entry) => entry.text));

  for (let i = 0; i < toEmbed.length; i += 1) {
    const vector = vectors[i];
    const task = toEmbed[i];

    if (!task || !Array.isArray(vector) || vector.length === 0) {
      queueMetrics.failed += 1;
      continue;
    }

    const embeddingJson = JSON.stringify(vector);

    try {
      await db
        .update(knowledgeTable)
        .set({ embedding: embeddingJson })
        .where(eq(knowledgeTable.id, task.row.id));

      addToCache(task.row.id, vector, buildUpdatedEntry(task.row, embeddingJson));

      queueMetrics.completed += 1;
      recordLatency(task.item);
    } catch (error) {
      queueMetrics.failed += 1;
      setLastError(error);
    }
  }
}

async function processEmbeddingQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (pendingOrder.length > 0) {
      const batchIds = pickNextBatchIds();
      if (batchIds.length === 0) continue;

      const batchItems: EmbeddingQueueItem[] = [];
      for (const id of batchIds) {
        const item = pendingById.get(id);
        pendingById.delete(id);
        if (item) batchItems.push(item);
      }

      if (batchItems.length === 0) continue;

      inflight += batchItems.length;
      try {
        await processEmbeddingBatch(batchItems);
      } catch (error) {
        queueMetrics.failed += batchItems.length;
        setLastError(error);
      } finally {
        inflight = Math.max(0, inflight - batchItems.length);
        queueMetrics.lastProcessedAt = new Date().toISOString();
      }
    }
  } finally {
    processing = false;
    if (pendingOrder.length > 0) {
      scheduleQueueProcessing();
    }
  }
}

export function enqueueKnowledgeEmbedding(params: {
  knowledgeId: number;
  text: string;
  reason?: string;
  skipIfPresent?: boolean;
}): boolean {
  const knowledgeId = Number(params.knowledgeId);
  if (!Number.isInteger(knowledgeId) || knowledgeId <= 0) return false;

  const text = normalizeText(params.text);
  if (!text) return false;

  const existing = pendingById.get(knowledgeId);
  const item: EmbeddingQueueItem = {
    knowledgeId,
    text,
    enqueuedAt: existing?.enqueuedAt ?? Date.now(),
    skipIfPresent: params.skipIfPresent ?? true,
    reason: (params.reason ?? existing?.reason ?? "kb-update").trim() || "kb-update",
  };

  pendingById.set(knowledgeId, item);
  if (!existing) {
    pendingOrder.push(knowledgeId);
  }

  scheduleQueueProcessing();
  return true;
}

export function getEmbeddingQueueStats(): EmbeddingQueueStats {
  const avgLatencyMs = queueMetrics.latencySamples > 0
    ? queueMetrics.latencyTotalMs / queueMetrics.latencySamples
    : 0;

  return {
    enabled: true,
    batchSize: EMBEDDING_QUEUE_BATCH_SIZE,
    maxWaitMs: EMBEDDING_QUEUE_MAX_WAIT_MS,
    pending: pendingOrder.length,
    inflight,
    completed: queueMetrics.completed,
    failed: queueMetrics.failed,
    dropped: queueMetrics.dropped,
    avgLatencyMs,
    lastLatencyMs: queueMetrics.lastLatencyMs,
    lastError: queueMetrics.lastError,
    lastProcessedAt: queueMetrics.lastProcessedAt,
  };
}

export async function waitForEmbeddingQueueIdle(timeoutMs = 4000): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (!processing && inflight === 0 && pendingOrder.length === 0) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return false;
}

export function resetEmbeddingQueueForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  pendingById.clear();
  pendingOrder.splice(0, pendingOrder.length);
  inflight = 0;
  processing = false;

  queueMetrics.completed = 0;
  queueMetrics.failed = 0;
  queueMetrics.dropped = 0;
  queueMetrics.latencyTotalMs = 0;
  queueMetrics.latencySamples = 0;
  queueMetrics.lastLatencyMs = 0;
  queueMetrics.lastError = null;
  queueMetrics.lastProcessedAt = null;
}
