import { describe, expect, it } from "vitest";
import { ProviderCircuitBreaker } from "../src/lib/providerCircuitBreaker";

describe("ProviderCircuitBreaker", () => {
  it("opens after threshold and blocks until cooldown expires", () => {
    let now = 1_000;
    const breaker = new ProviderCircuitBreaker({
      groq: {
        failureThreshold: 2,
        baseCooldownMs: 100,
      },
    }, () => now);

    expect(breaker.shouldAllow("groq").allowed).toBe(true);

    breaker.onFailure("groq", "http_500");
    expect(breaker.snapshot("groq").state).toBe("closed");

    breaker.onFailure("groq", "http_500");
    const opened = breaker.snapshot("groq");
    expect(opened.state).toBe("open");
    expect(opened.remainingCooldownMs).toBe(100);

    const blocked = breaker.shouldAllow("groq");
    expect(blocked.allowed).toBe(false);
    expect(blocked.state).toBe("open");

    now += 100;
    const halfOpenGate = breaker.shouldAllow("groq");
    expect(halfOpenGate.allowed).toBe(true);
    expect(halfOpenGate.state).toBe("half-open");
  });

  it("closes after successful half-open probe", () => {
    let now = 2_000;
    const breaker = new ProviderCircuitBreaker({
      openrouter: {
        failureThreshold: 1,
        baseCooldownMs: 50,
      },
    }, () => now);

    breaker.onFailure("openrouter", "rate_limit", { forceOpen: true });
    expect(breaker.snapshot("openrouter").state).toBe("open");

    now += 50;
    expect(breaker.shouldAllow("openrouter").state).toBe("half-open");

    breaker.onSuccess("openrouter");
    const closed = breaker.snapshot("openrouter");
    expect(closed.state).toBe("closed");
    expect(closed.consecutiveFailures).toBe(0);
    expect(closed.openedCount).toBe(0);
  });

  it("reopens with longer cooldown when half-open probe fails", () => {
    let now = 3_000;
    const breaker = new ProviderCircuitBreaker({
      anthropic: {
        failureThreshold: 1,
        baseCooldownMs: 40,
      },
    }, () => now);

    breaker.onFailure("anthropic", "http_500", { forceOpen: true });
    expect(breaker.snapshot("anthropic").remainingCooldownMs).toBe(40);

    now += 40;
    expect(breaker.shouldAllow("anthropic").allowed).toBe(true);
    expect(breaker.shouldAllow("anthropic").allowed).toBe(false);

    breaker.onFailure("anthropic", "probe_failed");
    const reopened = breaker.snapshot("anthropic");
    expect(reopened.state).toBe("open");
    expect(reopened.remainingCooldownMs).toBe(80);
  });

  it("supports cooldown overrides when forcing open", () => {
    let now = 4_000;
    const breaker = new ProviderCircuitBreaker({
      ollama: {
        failureThreshold: 3,
        baseCooldownMs: 100,
      },
    }, () => now);

    breaker.onFailure("ollama", "manual_open", { forceOpen: true, cooldownMs: 1_250 });

    const snapshot = breaker.snapshot("ollama");
    expect(snapshot.state).toBe("open");
    expect(snapshot.remainingCooldownMs).toBe(1_250);

    now += 1_250;
    expect(breaker.shouldAllow("ollama").allowed).toBe(true);
    expect(breaker.snapshot("ollama").state).toBe("half-open");
  });
});
