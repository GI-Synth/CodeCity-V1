import { db } from "@workspace/db";
import { knowledgeTable } from "@workspace/db/schema";
import { and, desc, eq, isNotNull, like, or, sql } from "drizzle-orm";
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

const QUERY_EMBED_CACHE_LIMIT = 256;
const QUERY_EMBED_TTL_MS = 60 * 60 * 1000;
const QUERY_RESULT_CACHE_LIMIT = 256;
const QUERY_RESULT_TTL_MS = 30 * 1000;
const KEYWORD_FALLBACK_ROW_LIMIT = 200;
const MIN_FTS_TERM_LENGTH = 2;
const MAX_FTS_TERMS = 6;

interface QueryEmbeddingCacheEntry {
  vector: number[];
  expiresAt: number;
  lastAccessAt: number;
}

interface QueryResultCacheEntry {
  results: SearchResult[];
  expiresAt: number;
  lastAccessAt: number;
}

interface QueryCacheStats {
  queryEmbeddingEntries: number;
  queryResultEntries: number;
  queryEmbeddingHits: number;
  queryEmbeddingMisses: number;
  queryResultHits: number;
  queryResultMisses: number;
  knowledgeDataVersion: number;
}

const queryEmbeddingCache = new Map<string, QueryEmbeddingCacheEntry>();
const queryResultCache = new Map<string, QueryResultCacheEntry>();

const queryCacheCounters = {
  queryEmbeddingHits: 0,
  queryEmbeddingMisses: 0,
  queryResultHits: 0,
  queryResultMisses: 0,
};

let knowledgeDataVersion = 1;

function normalizeText(text: string): string {
  return text.toLowerCase();
}

function normalizeQueryCacheKey(query: string): string {
  return normalizeText(query).trim();
}

function buildResultCacheKey(query: string, limit: number, options?: SearchOptions): string {
  const languageKey = options?.language?.trim().toLowerCase() || "any";
  const domains = Array.from(preferredDomains).sort().join(",");
  return `${normalizeQueryCacheKey(query)}|lang:${languageKey}|limit:${limit}|domains:${domains}|v:${knowledgeDataVersion}`;
}

function tokenizeKeywordQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_FTS_TERM_LENGTH)
    .slice(0, MAX_FTS_TERMS);
}

function escapeFtsTerm(term: string): string {
  return term.replace(/"/g, '""');
}

function buildFtsMatchQuery(query: string): string | null {
  const tokens = tokenizeKeywordQuery(query);
  if (tokens.length === 0) return null;

  return tokens
    .map((token) => `"${escapeFtsTerm(token)}"*`)
    .join(" OR ");
}

function markKnowledgeMutation(options?: { resetVectorCache?: boolean; removedIds?: number[] }): void {
  if (options?.removedIds && options.removedIds.length > 0) {
    const removed = new Set(options.removedIds);
    vectorCache = vectorCache.filter((cached) => !removed.has(cached.id));
  }

  if (options?.resetVectorCache) {
    vectorCache = [];
    cacheBuilt = false;
  }

  knowledgeDataVersion += 1;
  queryResultCache.clear();
}

function evictOldest<T extends { lastAccessAt: number }>(cache: Map<string, T>): void {
  let oldestKey = "";
  let oldestAccess = Number.POSITIVE_INFINITY;

  for (const [key, value] of cache.entries()) {
    if (value.lastAccessAt < oldestAccess) {
      oldestAccess = value.lastAccessAt;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

function getCachedQueryEmbedding(key: string): number[] | null {
  const now = Date.now();
  const cached = queryEmbeddingCache.get(key);
  if (!cached) {
    queryCacheCounters.queryEmbeddingMisses += 1;
    return null;
  }

  if (cached.expiresAt <= now) {
    queryEmbeddingCache.delete(key);
    queryCacheCounters.queryEmbeddingMisses += 1;
    return null;
  }

  cached.lastAccessAt = now;
  queryCacheCounters.queryEmbeddingHits += 1;
  return cached.vector;
}

function setCachedQueryEmbedding(key: string, vector: number[]): void {
  const now = Date.now();
  if (!queryEmbeddingCache.has(key) && queryEmbeddingCache.size >= QUERY_EMBED_CACHE_LIMIT) {
    evictOldest(queryEmbeddingCache);
  }

  queryEmbeddingCache.set(key, {
    vector,
    expiresAt: now + QUERY_EMBED_TTL_MS,
    lastAccessAt: now,
  });
}

function cloneSearchResults(results: SearchResult[]): SearchResult[] {
  return results.map((result) => ({ ...result }));
}

function getCachedSearchResults(key: string): SearchResult[] | null {
  const now = Date.now();
  const cached = queryResultCache.get(key);
  if (!cached) {
    queryCacheCounters.queryResultMisses += 1;
    return null;
  }

  if (cached.expiresAt <= now) {
    queryResultCache.delete(key);
    queryCacheCounters.queryResultMisses += 1;
    return null;
  }

  cached.lastAccessAt = now;
  queryCacheCounters.queryResultHits += 1;
  return cloneSearchResults(cached.results);
}

function setCachedSearchResults(key: string, results: SearchResult[]): void {
  const now = Date.now();
  if (!queryResultCache.has(key) && queryResultCache.size >= QUERY_RESULT_CACHE_LIMIT) {
    evictOldest(queryResultCache);
  }

  queryResultCache.set(key, {
    results: cloneSearchResults(results),
    expiresAt: now + QUERY_RESULT_TTL_MS,
    lastAccessAt: now,
  });
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
  queryResultCache.clear();
  console.log(`[VectorSearch] Cache built: ${vectorCache.length} vectors`);
}

export function setPreferredDomains(domains: string[]): void {
  const normalized = domains.map((domain) => domain.toLowerCase().trim()).filter(Boolean);
  preferredDomains = new Set(normalized.length > 0 ? normalized : ["general"]);
  queryResultCache.clear();
}

export function addToCache(
  id: number,
  vector: number[],
  entry: typeof knowledgeTable.$inferSelect,
): void {
  vectorCache = vectorCache.filter((cached) => cached.id !== id);
  vectorCache.push({ id, vector, entry });
  markKnowledgeMutation();
}

export function getVectorCacheSize(): number {
  return vectorCache.length;
}

export function getQueryCacheStats(): QueryCacheStats {
  return {
    queryEmbeddingEntries: queryEmbeddingCache.size,
    queryResultEntries: queryResultCache.size,
    queryEmbeddingHits: queryCacheCounters.queryEmbeddingHits,
    queryEmbeddingMisses: queryCacheCounters.queryEmbeddingMisses,
    queryResultHits: queryCacheCounters.queryResultHits,
    queryResultMisses: queryCacheCounters.queryResultMisses,
    knowledgeDataVersion,
  };
}

export function invalidateKnowledgeSearchCache(options: { resetVectorCache?: boolean } = {}): void {
  markKnowledgeMutation({ resetVectorCache: options.resetVectorCache });
}

export function removeVectorCacheEntry(entryId: number): void {
  markKnowledgeMutation({ removedIds: [entryId] });
}

export function resetQueryCacheStats(): void {
  queryCacheCounters.queryEmbeddingHits = 0;
  queryCacheCounters.queryEmbeddingMisses = 0;
  queryCacheCounters.queryResultHits = 0;
  queryCacheCounters.queryResultMisses = 0;
}

export function resetVectorSearchState(): void {
  vectorCache = [];
  cacheBuilt = false;
  preferredDomains = new Set<string>(["general"]);
  knowledgeDataVersion = 1;
  queryEmbeddingCache.clear();
  queryResultCache.clear();
  resetQueryCacheStats();
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

  const queryKey = normalizeQueryCacheKey(query);
  const cachedVector = getCachedQueryEmbedding(queryKey);
  const queryVector = cachedVector ?? await embed(query);

  if (!cachedVector) {
    setCachedQueryEmbedding(queryKey, queryVector);
  }

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
  const normalizedQuery = normalizeText(query).trim();
  if (!normalizedQuery) return [];

  const preferredLanguage = options?.language?.trim().toLowerCase();
  const languageFilter = preferredLanguage
    ? or(eq(knowledgeTable.language, preferredLanguage), eq(knowledgeTable.language, "general"))
    : undefined;

  const ftsQuery = buildFtsMatchQuery(normalizedQuery);
  if (ftsQuery) {
    try {
      const ftsWhere = sql`${knowledgeTable.id} IN (
        SELECT rowid
        FROM knowledge_fts
        WHERE knowledge_fts MATCH ${ftsQuery}
      )`;

      const rows = await db
        .select()
        .from(knowledgeTable)
        .where(languageFilter ? and(languageFilter, ftsWhere) : ftsWhere)
        .orderBy(desc(knowledgeTable.qualityScore), desc(knowledgeTable.useCount))
        .limit(limit);

      if (rows.length > 0) {
        return rows.map((entry) => ({
          entry,
          similarity: 0.58,
          source: "keyword" as const,
        }));
      }
    } catch {
      // FTS table/module can be unavailable in some SQLite runtimes.
    }
  }

  const tokens = tokenizeKeywordQuery(normalizedQuery);
  const searchTerms = tokens.length > 0 ? tokens : [normalizedQuery];

  const likeConditions = searchTerms.flatMap((term) => {
    const pattern = `%${term}%`;
    return [
      like(knowledgeTable.question, pattern),
      like(knowledgeTable.answer, pattern),
      like(knowledgeTable.problemType, pattern),
      like(knowledgeTable.patternTags, pattern),
    ];
  });

  if (likeConditions.length === 0) return [];

  const textFilter = or(...likeConditions);
  const rows = await db
    .select()
    .from(knowledgeTable)
    .where(languageFilter ? and(languageFilter, textFilter) : textFilter)
    .orderBy(desc(knowledgeTable.qualityScore), desc(knowledgeTable.useCount))
    .limit(Math.min(KEYWORD_FALLBACK_ROW_LIMIT, Math.max(limit, 20)));

  return rows.slice(0, limit).map((entry) => ({
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
  const cacheKey = buildResultCacheKey(query, limit, options);
  const cachedResults = getCachedSearchResults(cacheKey);
  if (cachedResults) {
    return cachedResults;
  }

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

  const finalResults = merged.slice(0, limit);
  setCachedSearchResults(cacheKey, finalResults);
  return finalResults;
}
