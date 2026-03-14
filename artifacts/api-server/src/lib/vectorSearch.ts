import { db } from "@workspace/db";
import { knowledgeTable } from "@workspace/db/schema";
import { isNotNull } from "drizzle-orm";
import { cosineSimilarity, embed } from "./embeddings";

interface SearchOptions {
  language?: string;
}

export interface SearchResult {
  entry: typeof knowledgeTable.$inferSelect;
  similarity: number;
  source: "vector" | "keyword";
}

interface CachedVector {
  id: number;
  vector: number[];
  entry: typeof knowledgeTable.$inferSelect;
}

let vectorCache: CachedVector[] = [];
let cacheBuilt = false;
let preferredDomains = new Set<string>(["general"]);

function normalizeText(text: string): string {
  return text.toLowerCase();
}

function parsePatternTags(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => String(tag).toLowerCase());
    }
  } catch {
    // Fall through to comma/space-based parsing.
  }

  return raw
    .split(/[\s,|]+/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function inferEntryDomains(entry: typeof knowledgeTable.$inferSelect): Set<string> {
  const domains = new Set<string>();
  const textBlob = normalizeText(`${entry.question} ${entry.answer} ${entry.problemType}`);

  if (entry.domain) {
    domains.add(entry.domain.toLowerCase());
  }

  const tags = parsePatternTags(entry.patternTags ?? null);
  for (const tag of tags) {
    if (tag.includes("audio")) domains.add("audio");
    if (tag.includes("plugin")) domains.add("plugin");
  }

  if (
    textBlob.includes("tone") ||
    textBlob.includes("web audio") ||
    textBlob.includes("midi") ||
    textBlob.includes("howler") ||
    textBlob.includes("wavesurfer")
  ) {
    domains.add("audio");
  }

  if (
    textBlob.includes("vst") ||
    textBlob.includes("juce") ||
    textBlob.includes("audio unit") ||
    textBlob.includes("plugin")
  ) {
    domains.add("plugin");
  }

  if (domains.size === 0) domains.add("general");
  return domains;
}

function applyDomainBoost(baseSimilarity: number, entry: typeof knowledgeTable.$inferSelect): number {
  if (preferredDomains.size === 0 || preferredDomains.has("general")) {
    // Keep neutral behavior when no domain preference is set.
    if (preferredDomains.size <= 1) return baseSimilarity;
  }

  const entryDomains = inferEntryDomains(entry);
  let boost = 0;

  for (const domain of preferredDomains) {
    if (domain === "general") continue;
    if (entryDomains.has(domain)) {
      boost += 0.1;
    }
  }

  return Math.min(1, baseSimilarity + boost);
}

function languageMatches(entryLanguage: string, requestedLanguage?: string): boolean {
  if (!requestedLanguage) return true;

  const req = requestedLanguage.toLowerCase();
  const entry = entryLanguage.toLowerCase();
  return entry === req || entry === "general";
}

function parseEmbedding(raw: string): number[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "number")) {
      return parsed;
    }
  } catch {
    // Ignore malformed embeddings.
  }

  return null;
}

export async function buildVectorCache(): Promise<void> {
  console.log("[VectorSearch] Building vector cache...");

  const entries = await db
    .select()
    .from(knowledgeTable)
    .where(isNotNull(knowledgeTable.embedding));

  vectorCache = entries
    .map((entry) => {
      const vector = entry.embedding ? parseEmbedding(entry.embedding) : null;
      if (!vector) return null;
      return {
        id: entry.id,
        vector,
        entry,
      } satisfies CachedVector;
    })
    .filter((value): value is CachedVector => Boolean(value));

  cacheBuilt = true;
  console.log(`[VectorSearch] Cache built: ${vectorCache.length} vectors`);
}

export function setPreferredDomains(domains: string[]): void {
  const normalized = domains.map((domain) => domain.toLowerCase().trim()).filter(Boolean);
  preferredDomains = new Set(normalized.length > 0 ? normalized : ["general"]);
}

export function addToCache(
  id: number,
  vector: number[],
  entry: typeof knowledgeTable.$inferSelect,
): void {
  vectorCache = vectorCache.filter((cached) => cached.id !== id);
  vectorCache.push({ id, vector, entry });
}

export function getVectorCacheSize(): number {
  return vectorCache.length;
}

export async function vectorSearch(
  query: string,
  limit: number = 5,
  threshold: number = 0.65,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  if (!cacheBuilt) {
    await buildVectorCache();
  }

  if (vectorCache.length === 0) return [];

  const queryVector = await embed(query);

  const scored = vectorCache
    .filter(({ entry }) => languageMatches(entry.language, options?.language))
    .map(({ entry, vector }) => {
      const similarity = cosineSimilarity(queryVector, vector);
      const boosted = applyDomainBoost(similarity, entry);
      return {
        entry,
        similarity: boosted,
        source: "vector" as const,
      };
    })
    .filter((result) => result.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

async function keywordSearchFallback(
  query: string,
  limit: number,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const lower = normalizeText(query);
  const rows = await db.select().from(knowledgeTable).limit(200);

  return rows
    .filter((entry) => languageMatches(entry.language, options?.language))
    .filter((entry) => {
      const question = normalizeText(entry.question);
      const answer = normalizeText(entry.answer);
      const tags = normalizeText(entry.patternTags ?? "");
      return question.includes(lower) || answer.includes(lower) || tags.includes(lower);
    })
    .slice(0, limit)
    .map((entry) => ({
      entry,
      similarity: 0.5,
      source: "keyword" as const,
    }));
}

export async function hybridSearch(
  query: string,
  limit: number = 5,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(query, limit, 0.6, options),
    keywordSearchFallback(query, limit, options),
  ]);

  const seen = new Set<number>();
  const merged: SearchResult[] = [];

  for (const result of vectorResults) {
    if (!seen.has(result.entry.id)) {
      seen.add(result.entry.id);
      merged.push(result);
    }
  }

  for (const result of keywordResults) {
    if (!seen.has(result.entry.id)) {
      seen.add(result.entry.id);
      merged.push(result);
    }
  }

  return merged.slice(0, limit);
}
