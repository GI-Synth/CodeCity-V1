const OLLAMA_BASE = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const MAX_CONCURRENT = 8;
const TIMEOUT_MS = 2000;

let semaphore = 0;

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
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {}, TIMEOUT_MS);
      return res.ok;
    } catch {
      return false;
    }
  },

  async listModels(): Promise<string[]> {
    try {
      const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {}, TIMEOUT_MS);
      if (!res.ok) return [];
      const data = await res.json() as { models?: Array<{ name: string }> };
      return (data.models ?? []).map(m => m.name);
    } catch {
      return [];
    }
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
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
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
