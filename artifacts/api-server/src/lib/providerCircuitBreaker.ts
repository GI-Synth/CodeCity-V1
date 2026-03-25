export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  baseCooldownMs: number;
  maxCooldownMs?: number;
  halfOpenMaxConcurrent?: number;
  halfOpenSuccessThreshold?: number;
}

export interface CircuitAttempt {
  allowed: boolean;
  state: CircuitState;
  retryAfterMs: number;
  reason?: string;
}

export interface CircuitStatus {
  key: string;
  state: CircuitState;
  consecutiveFailures: number;
  openedCount: number;
  cooldownUntilMs: number | null;
  remainingCooldownMs: number;
  probeInFlight: number;
  halfOpenSuccesses: number;
  lastFailureReason: string | null;
  lastFailureAtMs: number | null;
  lastSuccessAtMs: number | null;
}

interface CircuitNode {
  state: CircuitState;
  consecutiveFailures: number;
  openedCount: number;
  cooldownUntilMs: number | null;
  probeInFlight: number;
  halfOpenSuccesses: number;
  lastFailureReason: string | null;
  lastFailureAtMs: number | null;
  lastSuccessAtMs: number | null;
}

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function createDefaultNode(): CircuitNode {
  return {
    state: "closed",
    consecutiveFailures: 0,
    openedCount: 0,
    cooldownUntilMs: null,
    probeInFlight: 0,
    halfOpenSuccesses: 0,
    lastFailureReason: null,
    lastFailureAtMs: null,
    lastSuccessAtMs: null,
  };
}

export class ProviderCircuitBreaker<TProvider extends string = string> {
  private readonly config: Record<TProvider, CircuitBreakerConfig>;
  private readonly now: () => number;
  private readonly nodes = new Map<TProvider, CircuitNode>();

  constructor(config: Record<TProvider, CircuitBreakerConfig>, now: () => number = () => Date.now()) {
    this.config = config;
    this.now = now;
  }

  shouldAllow(provider: TProvider): CircuitAttempt {
    const node = this.getNode(provider);
    const config = this.getConfig(provider);
    const currentMs = this.now();

    if (node.state === "open") {
      const cooldownUntil = node.cooldownUntilMs ?? currentMs;
      if (currentMs >= cooldownUntil) {
        node.state = "half-open";
        node.halfOpenSuccesses = 0;
        node.probeInFlight = 0;
      } else {
        return {
          allowed: false,
          state: "open",
          retryAfterMs: Math.max(0, cooldownUntil - currentMs),
          reason: "cooldown_active",
        };
      }
    }

    if (node.state === "half-open") {
      const maxConcurrent = clampPositive(config.halfOpenMaxConcurrent ?? 1, 1);
      if (node.probeInFlight >= maxConcurrent) {
        return {
          allowed: false,
          state: "half-open",
          retryAfterMs: 0,
          reason: "probe_inflight",
        };
      }

      node.probeInFlight += 1;
      return {
        allowed: true,
        state: "half-open",
        retryAfterMs: 0,
      };
    }

    return {
      allowed: true,
      state: "closed",
      retryAfterMs: 0,
    };
  }

  onSuccess(provider: TProvider): void {
    const node = this.getNode(provider);
    const config = this.getConfig(provider);
    node.lastSuccessAtMs = this.now();

    if (node.state === "half-open") {
      if (node.probeInFlight > 0) {
        node.probeInFlight -= 1;
      }

      node.halfOpenSuccesses += 1;
      const successThreshold = clampPositive(config.halfOpenSuccessThreshold ?? 1, 1);
      if (node.halfOpenSuccesses >= successThreshold) {
        this.closeNode(node);
      }
      return;
    }

    this.closeNode(node);
  }

  onFailure(provider: TProvider, reason: string, options: { forceOpen?: boolean; cooldownMs?: number } = {}): void {
    const node = this.getNode(provider);
    const config = this.getConfig(provider);
    const currentMs = this.now();

    node.lastFailureReason = reason.trim().slice(0, 240);
    node.lastFailureAtMs = currentMs;

    if (node.state === "half-open" && node.probeInFlight > 0) {
      node.probeInFlight -= 1;
    }

    node.consecutiveFailures += 1;

    const threshold = clampPositive(config.failureThreshold, 1);
    const shouldOpen = options.forceOpen || node.state === "half-open" || node.consecutiveFailures >= threshold;
    if (!shouldOpen) return;

    node.state = "open";
    node.halfOpenSuccesses = 0;
    node.probeInFlight = 0;
    node.openedCount += 1;

    const baseCooldown = clampPositive(config.baseCooldownMs, 1000);
    const exponentialMultiplier = Math.min(8, Math.pow(2, Math.max(0, node.openedCount - 1)));
    const computedCooldown = Math.floor(baseCooldown * exponentialMultiplier);

    const maxCooldown = clampPositive(config.maxCooldownMs ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const overrideCooldown = options.cooldownMs && Number.isFinite(options.cooldownMs)
      ? Math.max(1, Math.floor(options.cooldownMs))
      : null;

    const cooldownMs = Math.min(overrideCooldown ?? computedCooldown, maxCooldown);
    node.cooldownUntilMs = currentMs + cooldownMs;
  }

  snapshot(provider: TProvider): CircuitStatus {
    const node = this.getNode(provider);
    const currentMs = this.now();
    const remainingCooldownMs = node.cooldownUntilMs
      ? Math.max(0, node.cooldownUntilMs - currentMs)
      : 0;

    return {
      key: provider,
      state: node.state,
      consecutiveFailures: node.consecutiveFailures,
      openedCount: node.openedCount,
      cooldownUntilMs: node.cooldownUntilMs,
      remainingCooldownMs,
      probeInFlight: node.probeInFlight,
      halfOpenSuccesses: node.halfOpenSuccesses,
      lastFailureReason: node.lastFailureReason,
      lastFailureAtMs: node.lastFailureAtMs,
      lastSuccessAtMs: node.lastSuccessAtMs,
    };
  }

  reset(provider?: TProvider): void {
    if (provider) {
      this.nodes.set(provider, createDefaultNode());
      return;
    }

    this.nodes.clear();
  }

  private getConfig(provider: TProvider): CircuitBreakerConfig {
    const config = this.config[provider];
    if (!config) {
      throw new Error(`Missing circuit breaker config for provider: ${String(provider)}`);
    }
    return config;
  }

  private getNode(provider: TProvider): CircuitNode {
    const existing = this.nodes.get(provider);
    if (existing) return existing;

    const created = createDefaultNode();
    this.nodes.set(provider, created);
    return created;
  }

  private closeNode(node: CircuitNode): void {
    node.state = "closed";
    node.consecutiveFailures = 0;
    node.openedCount = 0;
    node.cooldownUntilMs = null;
    node.probeInFlight = 0;
    node.halfOpenSuccesses = 0;
  }
}
