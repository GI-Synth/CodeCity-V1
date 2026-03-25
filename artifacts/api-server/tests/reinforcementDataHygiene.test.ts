import { afterEach, describe, expect, it } from "vitest";
import {
  REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV,
  REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV,
  classifyReinforcementEvent,
  isSyntheticReinforcementEvent,
} from "../src/lib/reinforcementDataHygiene";

const originalRealRegex = process.env[REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV];
const originalSyntheticRegex = process.env[REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV];

afterEach(() => {
  if (typeof originalRealRegex === "string") {
    process.env[REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV] = originalRealRegex;
  } else {
    delete process.env[REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV];
  }

  if (typeof originalSyntheticRegex === "string") {
    process.env[REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV] = originalSyntheticRegex;
  } else {
    delete process.env[REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV];
  }
});

describe("reinforcement data hygiene", () => {
  it("treats allowlisted real sources as non-synthetic", () => {
    const classification = classifyReinforcementEvent({
      source: "agent-verdict",
      verdictOrigin: "production",
      findingId: "finding-123",
    });

    expect(classification.synthetic).toBe(false);
    expect(classification.reason).toBe("real_source_allowlist");
  });

  it("detects explicit synthetic source hints", () => {
    expect(
      isSyntheticReinforcementEvent({
        source: "integration-test-runner",
        verdictOrigin: "pipeline",
        findingId: "finding-456",
      }),
    ).toBe(true);
  });

  it("detects synthetic patterns via verdictOrigin and findingId hints", () => {
    const fromVerdictOrigin = classifyReinforcementEvent({
      source: "external-review",
      verdictOrigin: "smoke-test-suite",
      findingId: "finding-789",
    });

    const fromFindingId = classifyReinforcementEvent({
      source: "external-review",
      verdictOrigin: "production",
      findingId: "fixture-case-42",
    });

    expect(fromVerdictOrigin.synthetic).toBe(true);
    expect(fromVerdictOrigin.reason).toBe("synthetic_metadata_hint");
    expect(fromFindingId.synthetic).toBe(true);
    expect(fromFindingId.reason).toBe("synthetic_metadata_hint");
  });

  it("supports env regex extensions", () => {
    process.env[REINFORCEMENT_REAL_SOURCE_ALLOWLIST_REGEX_ENV] = "^partner-review$";
    process.env[REINFORCEMENT_SYNTHETIC_SOURCE_HINT_REGEX_ENV] = "canary";

    const regexReal = classifyReinforcementEvent({
      source: "partner-review",
      verdictOrigin: "production",
      findingId: "finding-100",
    });

    const regexSynthetic = classifyReinforcementEvent({
      source: "partner-ingest",
      verdictOrigin: "production",
      findingId: "canary-signal-007",
    });

    expect(regexReal.synthetic).toBe(false);
    expect(regexReal.reason).toBe("real_source_regex");
    expect(regexSynthetic.synthetic).toBe(true);
    expect(regexSynthetic.reason).toBe("synthetic_hint_regex");
  });
});
