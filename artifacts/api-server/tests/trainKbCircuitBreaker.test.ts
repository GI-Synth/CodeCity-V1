import { beforeEach, describe, expect, it } from "vitest";
import {
  canAttemptTrainProviderForTests,
  getTrainProviderCircuitSnapshotForTests,
  markTrainProviderFailureForTests,
  markTrainProviderSuccessForTests,
  resetTrainProviderCircuitForTests,
} from "../../../scripts/train-kb";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("train-kb provider circuit breaker", () => {
  beforeEach(() => {
    resetTrainProviderCircuitForTests();
  });

  it("short-circuits when startup provider readiness is false", () => {
    const gate = canAttemptTrainProviderForTests("openrouter", false, "No OPENROUTER_API_KEY");

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("startup test");
    expect(getTrainProviderCircuitSnapshotForTests("openrouter").state).toBe("closed");
  });

  it("opens and recovers through half-open probe for groq", async () => {
    markTrainProviderFailureForTests("groq", "rate_limit", { forceOpen: true, cooldownMs: 30 });

    const blocked = canAttemptTrainProviderForTests("groq", true, "ready");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("circuit open");

    await sleep(40);

    const firstProbe = canAttemptTrainProviderForTests("groq", true, "ready");
    expect(firstProbe.allowed).toBe(true);
    expect(getTrainProviderCircuitSnapshotForTests("groq").state).toBe("half-open");

    const secondProbe = canAttemptTrainProviderForTests("groq", true, "ready");
    expect(secondProbe.allowed).toBe(false);
    expect(secondProbe.reason).toContain("probe_inflight");

    markTrainProviderSuccessForTests("groq");
    expect(getTrainProviderCircuitSnapshotForTests("groq").state).toBe("closed");
  });
});
