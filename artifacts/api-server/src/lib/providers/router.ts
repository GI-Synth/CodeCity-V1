/**
 * Provider Router — Intelligent failover across all AI providers.
 *
 * Every agent and the Mayor uses this. No agent call should ever fail because
 * one provider is rate-limited or down. Tries providers in priority chain order,
 * returns the first success. Never throws to the caller.
 */

import Anthropic from '@anthropic-ai/sdk';

export type ProviderName =
  | 'anthropic'
  | 'groq'
  | 'openrouter'
  | 'cerebras'
  | 'google'
  | 'ollama'
  | 'apifreellm';

export interface ProviderConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  rpmLimit: number;
  tpmLimit: number;
  rateLimitMs?: number;
  available: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderResponse {
  content: string;
  provider: ProviderName;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  fromFallback: boolean;
  fallbackReason?: string;
}

// Per-provider state — rate limit cooldowns etc.
const providerState: Map<ProviderName, {
  rateLimitedUntil: number;
  consecutiveErrors: number;
  lastCallTime: number;
  totalCalls: number;
  totalErrors: number;
}> = new Map();

export function getProviderConfigs(): ProviderConfig[] {
  return [
    {
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
      model: process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5',
      maxTokens: 4096,
      rpmLimit: 50,
      tpmLimit: 40000,
      available: !!process.env['ANTHROPIC_API_KEY'],
    },
    {
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: process.env['GROQ_API_KEY'] ?? '',
      model: process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile',
      maxTokens: 4096,
      rpmLimit: 30,
      tpmLimit: 6000,
      available: !!process.env['GROQ_API_KEY'],
    },
    {
      name: 'cerebras',
      baseUrl: (process.env['CEREBRAS_BASE_URL'] ?? 'https://api.cerebras.ai/v1').trim(),
      apiKey: (process.env['CEREBRAS_API_KEY'] ?? '').trim(),
      model: process.env['CEREBRAS_MODEL'] ?? 'llama3.1-70b',
      maxTokens: 2048,
      rpmLimit: 30,
      tpmLimit: 60000,
      available: !!(process.env['CEREBRAS_API_KEY'] ?? '').trim(),
    },
    {
      name: 'openrouter',
      baseUrl: (process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').trim(),
      apiKey: (process.env['OPENROUTER_API_KEY'] ?? '').trim(),
      model: process.env['OPENROUTER_FREE_MODEL'] ?? 'deepseek/deepseek-r1:free',
      maxTokens: 2048,
      rpmLimit: 20,
      tpmLimit: 20000,
      available: !!(process.env['OPENROUTER_API_KEY'] ?? '').trim(),
    },
    {
      name: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: (process.env['GOOGLE_API_KEY'] ?? '').trim(),
      model: process.env['GOOGLE_MODEL'] ?? 'gemini-2.0-flash',
      maxTokens: 4096,
      rpmLimit: 15,
      tpmLimit: 32000,
      available: !!(process.env['GOOGLE_API_KEY'] ?? '').trim(),
    },
    {
      name: 'ollama',
      baseUrl: (process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1').trim() || 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: process.env['OLLAMA_CODING_MODEL'] ?? 'qwen2.5-coder:14b',
      maxTokens: 4096,
      rpmLimit: 999,
      tpmLimit: 999999,
      available: true,
    },
    {
      name: 'apifreellm',
      baseUrl: (process.env['APIFREELLM_BASE_URL'] ?? 'https://apifreellm.com/v1').trim(),
      apiKey: (process.env['APIFREELLM_API_KEY'] ?? '').trim(),
      model: process.env['APIFREELLM_MODEL'] ?? 'gpt-4-turbo',
      maxTokens: 2000,
      rpmLimit: 2,
      tpmLimit: 10000,
      rateLimitMs: Number(process.env['APIFREELLM_RATE_LIMIT_MS'] ?? 25000),
      available: !!(process.env['APIFREELLM_API_KEY'] ?? '').trim(),
    },
  ];
}

// Priority chains per agent role
export const AGENT_PROVIDER_CHAINS: Record<string, ProviderName[]> = {
  mayor:         ['groq', 'anthropic', 'openrouter', 'google', 'cerebras', 'apifreellm', 'ollama'],
  security:      ['ollama', 'anthropic', 'groq', 'openrouter', 'cerebras', 'google', 'apifreellm'],
  console_log:   ['cerebras', 'groq', 'anthropic', 'openrouter', 'ollama', 'google', 'apifreellm'],
  architect:     ['google', 'anthropic', 'groq', 'openrouter', 'cerebras', 'ollama', 'apifreellm'],
  performance:   ['groq', 'cerebras', 'anthropic', 'openrouter', 'google', 'ollama', 'apifreellm'],
  quality:       ['groq', 'anthropic', 'cerebras', 'openrouter', 'google', 'ollama', 'apifreellm'],
  documentation: ['cerebras', 'groq', 'anthropic', 'openrouter', 'ollama', 'google', 'apifreellm'],
  default:       ['groq', 'anthropic', 'cerebras', 'openrouter', 'google', 'ollama', 'apifreellm'],
};

function getProviderState(name: ProviderName) {
  if (!providerState.has(name)) {
    providerState.set(name, {
      rateLimitedUntil: 0,
      consecutiveErrors: 0,
      lastCallTime: 0,
      totalCalls: 0,
      totalErrors: 0,
    });
  }
  return providerState.get(name)!;
}

function isProviderAvailable(config: ProviderConfig): boolean {
  if (!config.available) return false;
  const state = getProviderState(config.name);
  if (Date.now() < state.rateLimitedUntil) return false;
  if (state.consecutiveErrors >= 5) {
    if (Date.now() < state.rateLimitedUntil + 5 * 60 * 1000) return false;
    state.consecutiveErrors = 0;
  }
  return true;
}

async function enforceRateLimit(config: ProviderConfig): Promise<void> {
  if (!config.rateLimitMs) return;
  const state = getProviderState(config.name);
  const elapsed = Date.now() - state.lastCallTime;
  if (elapsed < config.rateLimitMs) {
    await new Promise<void>(r => setTimeout(r, config.rateLimitMs! - elapsed));
  }
}

async function callProvider(
  config: ProviderConfig,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<ProviderResponse | null> {
  const state = getProviderState(config.name);
  const start = Date.now();

  try {
    await enforceRateLimit(config);
    state.lastCallTime = Date.now();
    state.totalCalls++;

    let content = '';

    if (config.name === 'anthropic') {
      const client = new Anthropic({ apiKey: config.apiKey });
      const systemMsg = messages.find(m => m.role === 'system')?.content;
      const userMsgs = messages.filter(m => m.role !== 'system');
      const response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens ?? config.maxTokens,
        system: systemMsg,
        messages: userMsgs as Anthropic.MessageParam[],
      });
      content = response.content[0]?.type === 'text' ? response.content[0].text : '';
    } else if (config.name === 'google') {
      const url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;
      const googleMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const systemInstruction = messages.find(m => m.role === 'system')?.content;
      const body: Record<string, unknown> = {
        contents: googleMessages,
        generationConfig: { maxOutputTokens: maxTokens ?? config.maxTokens },
      };
      if (systemInstruction) body['systemInstruction'] = { parts: [{ text: systemInstruction }] };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        state.rateLimitedUntil = Date.now() + (retryAfter ? parseInt(retryAfter) * 1000 : 60000);
        state.consecutiveErrors++;
        return null;
      }
      if (!res.ok) {
        state.consecutiveErrors++;
        console.warn(`[ProviderRouter] google error: ${res.status}`);
        return null;
      }
      const data = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else {
      // OpenAI-compatible (groq, cerebras, openrouter, ollama, apifreellm)
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (config.name === 'openrouter') {
        headers['HTTP-Referer'] = 'https://codecity.app';
        headers['X-Title'] = 'CodeCity';
      }
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: maxTokens ?? config.maxTokens,
          temperature: 0.7,
          ...(config.name === 'openrouter' ? { reasoning: { exclude: true } } : {}),
        }),
      });
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const cooldown = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
        state.rateLimitedUntil = Date.now() + cooldown;
        state.consecutiveErrors++;
        console.warn(`[ProviderRouter] ${config.name} rate limited. Cooldown: ${Math.round(cooldown / 1000)}s`);
        return null;
      }
      if (!res.ok) {
        state.consecutiveErrors++;
        console.warn(`[ProviderRouter] ${config.name} error: ${res.status}`);
        return null;
      }
      const data = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { total_tokens?: number };
      };
      content = data.choices?.[0]?.message?.content ?? '';
      // OpenRouter can return null content with reasoning only
      if (!content && config.name === 'openrouter') {
        state.consecutiveErrors++;
        return null;
      }
    }

    state.consecutiveErrors = 0;

    return {
      content,
      provider: config.name,
      model: config.model,
      tokensUsed: 0,
      latencyMs: Date.now() - start,
      fromFallback: false,
    };
  } catch (err) {
    state.consecutiveErrors++;
    state.totalErrors++;
    const msg = (err as Error).message ?? "unknown";
    // Redact anything that looks like an API key in error messages
    const safeMsg = msg.replace(/(?:sk-|gsk_|key-|Bearer\s+)\S+/gi, "[REDACTED]");
    console.warn(`[ProviderRouter] ${config.name} threw error:`, safeMsg);
    return null;
  }
}

/** Main entry — tries providers in priority chain, returns first success. Never throws. */
export async function chat(
  messages: ChatMessage[],
  agentRole: string = 'default',
  maxTokens?: number,
): Promise<ProviderResponse> {
  const configs = getProviderConfigs();
  const configMap = new Map(configs.map(c => [c.name, c]));
  const chain = AGENT_PROVIDER_CHAINS[agentRole] ?? AGENT_PROVIDER_CHAINS['default']!;

  const attempted: ProviderName[] = [];

  for (const providerName of chain) {
    const config = configMap.get(providerName);
    if (!config) continue;
    if (!isProviderAvailable(config)) {
      const state = getProviderState(providerName);
      const waitMs = state.rateLimitedUntil - Date.now();
      if (waitMs > 0) {
        console.log(`[ProviderRouter] Skipping ${providerName} — rate limited for ${Math.round(waitMs / 1000)}s more`);
      }
      continue;
    }

    attempted.push(providerName);
    const result = await callProvider(config, messages, maxTokens);

    if (result) {
      if (attempted.length > 1) {
        result.fromFallback = true;
        result.fallbackReason = `Primary providers unavailable: ${attempted.slice(0, -1).join(', ')}`;
        console.log(`[ProviderRouter] Used fallback ${providerName} for ${agentRole}. Tried: ${attempted.join(' → ')}`);
      }
      return result;
    }
  }

  console.error(`[ProviderRouter] ALL providers failed for ${agentRole}. Attempted: ${attempted.join(', ')}`);
  return {
    content: `Unable to process request — all AI providers temporarily unavailable. Attempted: ${attempted.join(', ')}`,
    provider: 'ollama',
    model: 'none',
    tokensUsed: 0,
    latencyMs: 0,
    fromFallback: true,
    fallbackReason: 'all_providers_failed',
  };
}

/** Get current provider health status for dashboard. */
export function getProviderStatus(): Record<ProviderName, {
  available: boolean;
  configured: boolean;
  rateLimitedUntil: number;
  rateLimitedForMs: number;
  consecutiveErrors: number;
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
}> {
  const configs = getProviderConfigs();
  const result = {} as Record<ProviderName, ReturnType<typeof getProviderStatus>[ProviderName]>;

  for (const config of configs) {
    const state = getProviderState(config.name);
    const rateLimitedForMs = Math.max(0, state.rateLimitedUntil - Date.now());
    result[config.name] = {
      available: isProviderAvailable(config),
      configured: config.available,
      rateLimitedUntil: state.rateLimitedUntil,
      rateLimitedForMs,
      consecutiveErrors: state.consecutiveErrors,
      totalCalls: state.totalCalls,
      totalErrors: state.totalErrors,
      errorRate: state.totalCalls > 0 ? state.totalErrors / state.totalCalls : 0,
    };
  }

  return result;
}
