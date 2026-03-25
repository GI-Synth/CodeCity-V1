export function modelMatches(candidate: string, preferred: string): boolean {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedPreferred = preferred.toLowerCase();
  if (normalizedCandidate === normalizedPreferred) return true;

  const preferredBase = normalizedPreferred.split(":")[0];
  return (
    normalizedCandidate.startsWith(`${normalizedPreferred}:`)
    || normalizedCandidate.startsWith(`${preferredBase}:`)
    || normalizedCandidate.startsWith(`${preferredBase}-`)
  );
}

export function pickBestModel(models: string[], priorities: readonly string[]): string {
  for (const preferred of priorities) {
    const match = models.find((model) => modelMatches(model, preferred));
    if (match) return match;
  }

  const codeModel = models.find((model) => model.toLowerCase().includes("code"));
  if (codeModel) return codeModel;

  return models[0];
}
