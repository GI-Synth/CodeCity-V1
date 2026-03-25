import { loadEnvFile } from "./loadEnv";
import { pickBestModel } from "./ollamaModelSelection";

const MAX_CONCURRENT = 8;
const TIMEOUT_MS = 2000;
const BEST_MODEL_CACHE_MS = 60_000;

const MODEL_PRIORITY = [
  "deepseek-coder-v2:16b",
  "deepseek-coder:6.7b",
  "codellama:13b",
  "codellama:7b",
] as const;

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface BestModelCache {
  value: string | null;
  expiresAt: number;
}

export interface OllamaConnectionStatus {
  host: string;
  reachable: boolean;
  models: string[];
  latencyMs: number;
}

let semaphore = 0;
let bestModelCache: BestModelCache = {
  value: null,
  expiresAt: 0,
};

function normalizeHost(rawHost: string): string {
  return rawHost.replace(/\/+$/, "");
}

function getOllamaHost(): string {
  // Ensure .env has been loaded even if this module is imported before startup bootstrap.
  loadEnvFile();
  const configuredHost = process.env["OLLAMA_HOST"]?.trim();
  const host = configuredHost && configuredHost.length > 0
    ? configuredHost
    : "http://localhost:11434";
  return normalizeHost(host);
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const ollamaClient = {
  getHost(): string {
    return getOllamaHost();
  },

  async testConnection(): Promise<OllamaConnectionStatus> {
    const host = getOllamaHost();
    const startedAt = Date.now();

    try {
      const res = await fetchWithTimeout(`${host}/api/tags`, {}, TIMEOUT_MS);
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        return {
          host,
          reachable: false,
          models: [],
          latencyMs,
        };
      }

      const data = await res.json() as OllamaTagsResponse;
      return {
        host,
        reachable: true,
        models: (data.models ?? []).map((model) => model.name),
        latencyMs,
      };
    } catch {
      return {
        host,
        reachable: false,
        models: [],
        latencyMs: Date.now() - startedAt,
      };
    }
  },

  async isAvailable(): Promise<boolean> {
    const status = await this.testConnection();
    return status.reachable;
  },

  async listModels(): Promise<string[]> {
    const status = await this.testConnection();
    return status.reachable ? status.models : [];
  },

  async selectBestModel(forceRefresh = false): Promise<string | null> {
    const now = Date.now();
    if (!forceRefresh && bestModelCache.expiresAt > now) {
      return bestModelCache.value;
    }

    const models = await this.listModels();
    const selected = models.length > 0 ? pickBestModel(models, MODEL_PRIORITY) : null;
    bestModelCache = {
      value: selected,
      expiresAt: now + BEST_MODEL_CACHE_MS,
    };
    return selected;
  },

  async checkModel(model: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => m === model || m.startsWith(model.split(":")[0]));
  },

  async generate(params: {
    model: string;
    system: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    if (semaphore >= MAX_CONCURRENT) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (semaphore < MAX_CONCURRENT) break;
        if (i === 9) throw new Error("Ollama unavailable: semaphore timeout");
      }
    }

    semaphore++;
    try {
      const ollamaHost = getOllamaHost();
      const res = await fetch(`${ollamaHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: params.model,
          system: params.system,
          prompt: params.prompt,
          stream: false,
          options: {
            temperature: params.temperature ?? 0.4,
            num_predict: params.maxTokens ?? 1000,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama unavailable: HTTP ${res.status} — ${text}`);
      }

      const data = await res.json() as { response: string };
      return data.response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg.startsWith("Ollama unavailable") ? msg : `Ollama unavailable: ${msg}`);
    } finally {
      semaphore--;
    }
  },
};
