interface KbSessionState {
  startedAt: string;
  totalEscalations: number;
  kbHits: number;
  kbMisses: number;
  kbSaves: number;
  vectorHits: number;
  keywordHits: number;
  similarityTotal: number;
  similaritySamples: number;
}

export interface KbSessionStats extends KbSessionState {
  kbHitRate: number;
  avgSimilarity: number;
}

const sessionState: KbSessionState = {
  startedAt: new Date().toISOString(),
  totalEscalations: 0,
  kbHits: 0,
  kbMisses: 0,
  kbSaves: 0,
  vectorHits: 0,
  keywordHits: 0,
  similarityTotal: 0,
  similaritySamples: 0,
};

export function recordEscalationAttempt(): void {
  sessionState.totalEscalations += 1;
}

export function recordKbHit(source: "vector" | "keyword" | "legacy" = "legacy", similarity?: number): void {
  sessionState.kbHits += 1;

  if (source === "vector") {
    sessionState.vectorHits += 1;
  }

  if (source === "keyword") {
    sessionState.keywordHits += 1;
  }

  if (typeof similarity === "number" && Number.isFinite(similarity)) {
    sessionState.similarityTotal += similarity;
    sessionState.similaritySamples += 1;
  }
}

export function recordKbMiss(): void {
  sessionState.kbMisses += 1;
}

export function recordKbSave(): void {
  sessionState.kbSaves += 1;
}

export function getKbSessionStats(): KbSessionStats {
  const totalLookups = sessionState.kbHits + sessionState.kbMisses;
  const kbHitRate = totalLookups > 0 ? sessionState.kbHits / totalLookups : 0;
  const avgSimilarity = sessionState.similaritySamples > 0
    ? sessionState.similarityTotal / sessionState.similaritySamples
    : 0;

  return {
    ...sessionState,
    kbHitRate,
    avgSimilarity,
  };
}

export function resetKbSessionStats(): void {
  sessionState.startedAt = new Date().toISOString();
  sessionState.totalEscalations = 0;
  sessionState.kbHits = 0;
  sessionState.kbMisses = 0;
  sessionState.kbSaves = 0;
  sessionState.vectorHits = 0;
  sessionState.keywordHits = 0;
  sessionState.similarityTotal = 0;
  sessionState.similaritySamples = 0;
}
