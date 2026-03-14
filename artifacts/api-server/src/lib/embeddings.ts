import path from "node:path";
import { db } from "@workspace/db";
import { knowledgeTable } from "@workspace/db/schema";
import { eq, isNull } from "drizzle-orm";

type TransformersModule = typeof import("@xenova/transformers");

const MODEL = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
const BATCH_SIZE = 32;
const UPSERT_BATCH_SIZE = 10;

let embedder: any = null;
let transformersModulePromise: Promise<TransformersModule> | null = null;

async function loadTransformersModule(): Promise<TransformersModule> {
  if (!transformersModulePromise) {
    transformersModulePromise = import("@xenova/transformers").then((module) => {
      // Run locally and cache model files on disk for reuse between runs.
      module.env.allowRemoteModels = true;
      module.env.localModelPath = path.resolve(process.cwd(), "models");
      return module;
    });
  }

  return await transformersModulePromise;
}

function normalizeEmbeddingText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 512);
}

function zeroVector(): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => 0);
}

async function getEmbedder(): Promise<any> {
  if (!embedder) {
    const { pipeline } = await loadTransformersModule();
    console.log("[Embeddings] Loading model...");
    embedder = await pipeline("feature-extraction", MODEL, {
      quantized: true,
    });
    console.log("[Embeddings] Model ready");
  }
  return embedder;
}

export function isEmbeddingModelLoaded(): boolean {
  return Boolean(embedder);
}

export async function embed(text: string): Promise<number[]> {
  const normalized = normalizeEmbeddingText(text);
  if (!normalized) return zeroVector();

  const e = await getEmbedder();
  const output = await e(normalized, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data) as number[];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const e = await getEmbedder();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(normalizeEmbeddingText);
    const output = await e(batch, {
      pooling: "mean",
      normalize: true,
    });

    for (let j = 0; j < batch.length; j++) {
      const start = j * EMBEDDING_DIM;
      const end = (j + 1) * EMBEDDING_DIM;
      results.push(Array.from(output.data.slice(start, end)) as number[]);
    }
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function embedExistingEntries(): Promise<void> {
  const unembedded = await db
    .select({ id: knowledgeTable.id, question: knowledgeTable.question, answer: knowledgeTable.answer })
    .from(knowledgeTable)
    .where(isNull(knowledgeTable.embedding));

  if (unembedded.length === 0) {
    console.log("[Embeddings] All entries already embedded");
    return;
  }

  console.log(`[Embeddings] Embedding ${unembedded.length} entries...`);

  for (let i = 0; i < unembedded.length; i += UPSERT_BATCH_SIZE) {
    const batch = unembedded.slice(i, i + UPSERT_BATCH_SIZE);
    const texts = batch.map((entry) => normalizeEmbeddingText(`${entry.question} ${entry.answer}`));
    const vectors = await embedBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      await db
        .update(knowledgeTable)
        .set({ embedding: JSON.stringify(vectors[j]) })
        .where(eq(knowledgeTable.id, batch[j].id));
    }

    const done = Math.min(i + UPSERT_BATCH_SIZE, unembedded.length);
    console.log(`[Embeddings] ${done}/${unembedded.length} embedded`);
  }

  console.log("[Embeddings] All entries embedded");
}

export { EMBEDDING_DIM };
