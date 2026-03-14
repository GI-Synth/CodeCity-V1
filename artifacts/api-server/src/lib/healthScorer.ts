import type { Building, CityLayout } from "./types";

export interface ExecutionHealthSummary {
  totalRuns: number;
  success: number;
  failed: number;
  blocked: number;
  timeout: number;
}

function computeExecutionScore(summary?: ExecutionHealthSummary): number {
  if (!summary || summary.totalRuns <= 0) return 0.5;

  const total = Math.max(1, summary.totalRuns);
  const weightedSuccess = summary.success;
  const weightedFailure = (summary.failed + summary.timeout) * 1.0;
  const weightedBlocked = summary.blocked * 0.5;

  const normalized = (weightedSuccess - weightedFailure - weightedBlocked) / total;
  return Math.max(0, Math.min(1, 0.5 + (normalized * 0.5)));
}

export function computeHealthScore(buildings: Building[], executionSummary?: ExecutionHealthSummary): { score: number; season: string } {
  if (buildings.length === 0) return { score: 50, season: "autumn" };

  const testFiles = buildings.filter(b => b.fileType === "test");
  const districtTestMap = new Map<string, boolean>();
  for (const b of buildings) {
    const districtKey = b.filePath.split("/").slice(0, 2).join("/");
    if (b.fileType === "test") districtTestMap.set(districtKey, true);
  }

  const coverages = buildings.map(b => {
    if (b.testCoverage > 0) return b.testCoverage;
    const districtKey = b.filePath.split("/").slice(0, 2).join("/");
    if (districtTestMap.has(districtKey)) return 0.7;
    return 0;
  });

  const testCoverageScore = coverages.reduce((s, c) => s + c, 0) / (coverages.length || 1);
  const cleanRatio = buildings.filter(b => b.status === "healthy" || b.status === "glowing").length / (buildings.length || 1);
  const avgComplexity = buildings.reduce((s, b) => s + b.complexity, 0) / (buildings.length || 1);
  const complexityScore = Math.max(0, Math.min(1, 1 - avgComplexity / 30));
  const testFileRatio = Math.min(1, testFiles.length / (buildings.length || 1));
  const executionScore = computeExecutionScore(executionSummary);

  const healthScore =
    testCoverageScore * 0.35 +
    cleanRatio * 0.25 +
    complexityScore * 0.20 +
    testFileRatio * 0.10 +
    executionScore * 0.10;

  const score = Math.round(healthScore * 100);

  let season: string;
  if (healthScore >= 0.80) season = "summer";
  else if (healthScore >= 0.60) season = "spring";
  else if (healthScore >= 0.40) season = "autumn";
  else season = "winter";

  return { score, season };
}

export function computeDistrictHealth(buildings: Building[]): number {
  if (buildings.length === 0) return 50;
  const { score } = computeHealthScore(buildings);
  return score;
}
