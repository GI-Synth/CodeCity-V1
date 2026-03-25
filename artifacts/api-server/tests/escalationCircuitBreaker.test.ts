import { beforeEach, describe, expect, it } from "vitest";
import {
  canAttemptEscalationProviderForTests,
  getEscalationProviderCircuitSnapshot,
  markEscalationProviderFailureForTests,
  markEscalationProviderSuccessForTests,
  resetEscalationProviderCircuit,
} from "../src/lib/escalationEngine";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("escalation provider circuit breaker", () => {
  beforeEach(() => {
    resetEscalationProviderCircuit();
  });

  it("blocks requests during cooldown and recovers through half-open probe", async () => {
    markEscalationProviderFailureForTests("groq", "rate_limit", { forceOpen: true, cooldownMs: 35 });

    const blocked = canAttemptEscalationProviderForTests("groq");
    expect(blocked).toBe(false);
    expect(getEscalationProviderCircuitSnapshot("groq").state).toBe("open");

    await sleep(45);

    const firstProbe = canAttemptEscalationProviderForTests("groq");
    expect(firstProbe).toBe(true);
    expect(getEscalationProviderCircuitSnapshot("groq").state).toBe("half-open");

    const secondProbe = canAttemptEscalationProviderForTests("groq");
    expect(secondProbe).toBe(false);

    markEscalationProviderSuccessForTests("groq");
    expect(getEscalationProviderCircuitSnapshot("groq").state).toBe("closed");
    expect(canAttemptEscalationProviderForTests("groq")).toBe(true);
  });

  it("re-opens the circuit if a half-open probe fails", async () => {
    markEscalationProviderFailureForTests("openrouter", "http_500", { forceOpen: true, cooldownMs: 20 });

    await sleep(25);
    expect(canAttemptEscalationProviderForTests("openrouter")).toBe(true);

    markEscalationProviderFailureForTests("openrouter", "probe_failed");
    const reopened = getEscalationProviderCircuitSnapshot("openrouter");

    expect(reopened.state).toBe("open");
    expect(reopened.remainingCooldownMs).toBeGreaterThan(0);
  });
});
