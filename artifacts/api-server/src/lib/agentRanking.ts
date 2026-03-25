export function computeRank(totalTasks: number, accuracy: number, truePositives: number): string {
  if (accuracy >= 0.90 && totalTasks >= 100 && truePositives >= 10) return "principal";
  if (accuracy >= 0.80 && totalTasks >= 50) return "senior";
  if (accuracy >= 0.60 && totalTasks >= 20) return "mid";
  return "junior";
}
