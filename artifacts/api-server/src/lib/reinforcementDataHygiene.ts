export type ReinforcementEventLike = {
  source?: string | null;
  verdictOrigin?: string | null;
  findingId?: string | null;
};

export type ReinforcementEventClassificationReason =
  | "real_source_allowlist"
  | "real_source_regex"
  | "synthetic_source_hint"
  | "synthetic_metadata_hint"
  | "synthetic_hint_regex"
  | "unknown";

export type ReinforcementEventClassification = {
  synthetic: boolean;
  reason: ReinforcementEventClassificationReason;
  normalizedSource: string;
};

export const DEFAULT_REAL_SOURCE_ALLOWLIST = [
  "agent-verdict",
  "recommendation-feedback",
  "import-review",
  "aging-policy",
] as const;

export const DEFAULT_SYNTHETIC_SOURCE_HINTS = [
  "unit-test",
  "integration-test",
  "e2e-test",
  "smoke-test",
  "synthetic",
  "demo",
  "fixture",
  "mock",
  "seed",
  "probe",
  "benchmark",
] as const;

export const REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV = "REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX";
export const REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV = "REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX";

const DEFAULT_REAL_SOURCE_SET: ReadonlySet<string> = new Set(DEFAULT_REAL_SOURCE_ALLOWLIST);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function parseOptionalRegex(raw: string | null | undefined): RegExp | null {
  const normalized = (raw ?? "").trim();
  if (!normalized) return null;

  try {
    return new RegExp(normalized, "i");
  } catch {
    return null;
  }
}

function containsSyntheticHint(text: string): boolean {
  if (!text) return false;
  return DEFAULT_SYNTHETIC_SOURCE_HINTS.some((hint) => text.includes(hint));
}

function buildHintHaystack(event: ReinforcementEventLike): string {
  return [
    normalizeText(event.source),
    normalizeText(event.verdictOrigin),
    normalizeText(event.findingId),
  ]
    .filter(Boolean)
    .join(" ");
}

export function classifyReinforcementEvent(
  event: ReinforcementEventLike,
  env: NodeJS.ProcessEnv = process.env,
): ReinforcementEventClassification {
  const normalizedSource = normalizeText(event.source);
  const hintHaystack = buildHintHaystack(event);

  if (DEFAULT_REAL_SOURCE_SET.has(normalizedSource)) {
    return {
      synthetic: false,
      reason: "real_source_allowlist",
      normalizedSource,
    };
  }

  const realSourceRegex = parseOptionalRegex(env[REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV]);
  if (realSourceRegex && realSourceRegex.test(normalizedSource)) {
    return {
      synthetic: false,
      reason: "real_source_regex",
      normalizedSource,
    };
  }

  if (containsSyntheticHint(normalizedSource)) {
    return {
      synthetic: true,
      reason: "synthetic_source_hint",
      normalizedSource,
    };
  }

  if (containsSyntheticHint(hintHaystack)) {
    return {
      synthetic: true,
      reason: "synthetic_metadata_hint",
      normalizedSource,
    };
  }

  const syntheticHintRegex = parseOptionalRegex(env[REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV]);
  if (syntheticHintRegex && syntheticHintRegex.test(hintHaystack)) {
    return {
      synthetic: true,
      reason: "synthetic_hint_regex",
      normalizedSource,
    };
  }

  return {
    synthetic: false,
    reason: "unknown",
    normalizedSource,
  };
}

export function isSyntheticReinforcementEvent(
  event: ReinforcementEventLike,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return classifyReinforcementEvent(event, env).synthetic;
}

export function filterSyntheticReinforcementEvents<T extends ReinforcementEventLike>(
  events: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  return events.filter((event) => isSyntheticReinforcementEvent(event, env));
}

export function filterNonSyntheticReinforcementEvents<T extends ReinforcementEventLike>(
  events: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  return events.filter((event) => !isSyntheticReinforcementEvent(event, env));
}
