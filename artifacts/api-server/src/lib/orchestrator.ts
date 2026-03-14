import { wsServer } from './wsServer';
import { db } from '@workspace/db';
import { DEFAULT_SETTINGS, agentsTable, eventsTable, knowledgeTable, reposTable, settingsTable } from '@workspace/db/schema';
import { buildOrchestratorPrompt } from './orchestratorPrompts';
import { desc, inArray } from 'drizzle-orm';
import { ollamaClient } from './ollamaClient';

const ORCHESTRATOR_INTERVAL_MS = 60000;
const ORCHESTRATOR_SETTING_KEYS = [
  'orchestrator_model',
  'groq_model',
  'openrouter_model',
  'ollama_fast_model',
] as const;

interface OrchestratorSettings {
  orchestrator_model: string;
  groq_model: string;
  openrouter_model: string;
  ollama_fast_model: string;
}

const ORCHESTRATOR_SETTING_DEFAULTS: OrchestratorSettings = {
  orchestrator_model: DEFAULT_SETTINGS['orchestrator_model'] ?? 'groq',
  groq_model: DEFAULT_SETTINGS['groq_model'] ?? 'llama-3.3-70b-versatile',
  openrouter_model: DEFAULT_SETTINGS['openrouter_model'] ?? 'openrouter/codellama-70b',
  ollama_fast_model: DEFAULT_SETTINGS['ollama_fast_model'] ?? 'deepseek-coder:6.7b',
};

export interface CityBriefing {
  totalBuildings: number;
  untestedBuildings: number;
  fireBuildings: string[];
  highComplexity: string[];
  activeAgents: number;
  idleAgents: number;
  kbEntries: number;
  kbHitRate: number;
  recentBugs: string[];
  healthScore: number;
  season: string;
}

export interface OrchestratorDirective {
  priority_targets: string[];
  agent_assignments: { agentId: string; buildingId: string; reason: string }[];
  bulletin_message: string;
  escalate_architectural: boolean;
  reasoning: string;
}

class Orchestrator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastDirective: OrchestratorDirective | null = null;
  private nextRun: number = Date.now();
  private model: string = ORCHESTRATOR_SETTING_DEFAULTS.orchestrator_model;

  start(): void {
    this.intervalId = setInterval(() => this.think(), ORCHESTRATOR_INTERVAL_MS);
    setTimeout(() => this.think(), 5000);
    this.nextRun = Date.now() + ORCHESTRATOR_INTERVAL_MS;
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async think(): Promise<void> {
    try {
      const briefing = await this.buildCityBriefing();
      const directive = await this.callMayorAI(briefing);
      await this.executeDirective(directive);
      this.lastDirective = directive;
      wsServer.broadcastEventLog('ORCHESTRATOR', directive.bulletin_message, 'info');
      this.nextRun = Date.now() + ORCHESTRATOR_INTERVAL_MS;
    } catch (err) {
      console.warn('[Orchestrator] Think cycle failed:', err);
    }
  }

  private async buildCityBriefing(): Promise<CityBriefing> {
    // Query DB for city state
    const [repo] = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
    const layout = repo?.layoutData ? JSON.parse(repo.layoutData) : null;
    const buildings = layout ? layout.districts.flatMap((d: any) => d.buildings) : [];
    const fireBuildings = buildings.filter((b: any) => b.status === 'fire').map((b: any) => b.id);
    const highComplexity = buildings.filter((b: any) => b.complexity > 15 && (!b.hasTests || b.testCoverage < 0.3)).map((b: any) => b.id);
    const untestedBuildings = buildings.filter((b: any) => !b.hasTests || b.testCoverage < 0.1).length;
    const totalBuildings = buildings.length;
    const [agents, kb, events] = await Promise.all([
      db.select().from(agentsTable),
      db.select().from(knowledgeTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(20),
    ]);
    const activeAgents = agents.filter((a: any) => a.status === 'working').length;
    const idleAgents = agents.filter((a: any) => a.status === 'idle').length;
    const kbEntries = kb.length;
    const kbHitRate = kbEntries > 0 ? Math.min(1, agents.reduce((s: number, a: any) => s + (a.kbHits ?? 0), 0) / kbEntries) : 0;
    const recentBugs = events.filter((e: any) => e.type === 'bug_found').slice(0, 5).map((e: any) => e.message);
    const healthScore = layout?.healthScore ?? 50;
    const season = layout?.season ?? 'unknown';
    return {
      totalBuildings,
      untestedBuildings,
      fireBuildings,
      highComplexity,
      activeAgents,
      idleAgents,
      kbEntries,
      kbHitRate,
      recentBugs,
      healthScore,
      season,
    };
  }

  private async getSettings(): Promise<OrchestratorSettings> {
    try {
      const rows = await db
        .select({ key: settingsTable.key, value: settingsTable.value })
        .from(settingsTable)
        .where(inArray(settingsTable.key, [...ORCHESTRATOR_SETTING_KEYS]));

      const map = new Map<string, string>();
      for (const row of rows) map.set(row.key, row.value);

      return {
        orchestrator_model: map.get('orchestrator_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.orchestrator_model,
        groq_model: map.get('groq_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.groq_model,
        openrouter_model: map.get('openrouter_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.openrouter_model,
        ollama_fast_model: map.get('ollama_fast_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.ollama_fast_model,
      };
    } catch {
      return ORCHESTRATOR_SETTING_DEFAULTS;
    }
  }

  private parseDirective(responseText: string, briefing: CityBriefing): OrchestratorDirective {
    const fallback = this.ruleBasedDirective(briefing);

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;

      const parsed = JSON.parse(jsonMatch[0]) as Partial<OrchestratorDirective>;
      if (!Array.isArray(parsed.priority_targets)) return fallback;

      const priorityTargets = parsed.priority_targets
        .filter((target): target is string => typeof target === 'string' && target.trim().length > 0)
        .slice(0, 50);

      if (priorityTargets.length === 0) return fallback;

      const assignments = Array.isArray(parsed.agent_assignments)
        ? parsed.agent_assignments
          .filter((assignment): assignment is { agentId: string; buildingId: string; reason: string } => {
            return typeof assignment?.agentId === 'string'
              && typeof assignment?.buildingId === 'string'
              && typeof assignment?.reason === 'string';
          })
          .slice(0, 50)
        : [];

      return {
        priority_targets: priorityTargets,
        agent_assignments: assignments,
        bulletin_message: typeof parsed.bulletin_message === 'string' && parsed.bulletin_message.trim().length > 0
          ? parsed.bulletin_message
          : fallback.bulletin_message,
        escalate_architectural: Boolean(parsed.escalate_architectural),
        reasoning: typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
          ? parsed.reasoning
          : fallback.reasoning,
      };
    } catch {
      return fallback;
    }
  }

  private async callGroq(prompt: string, model: string): Promise<string> {
    const key = process.env['GROQ_API_KEY'];
    if (!key) throw new Error('Missing GROQ_API_KEY');

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      throw new Error(`Groq request failed (${res.status})`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async callOpenRouter(prompt: string, model: string): Promise<string> {
    const key = process.env['OPENROUTER_API_KEY'];
    if (!key) throw new Error('Missing OPENROUTER_API_KEY');

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter request failed (${res.status})`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async callOllama(prompt: string, model: string): Promise<string> {
    const available = await ollamaClient.isAvailable();
    if (!available) throw new Error('Ollama unavailable');

    return ollamaClient.generate({
      model,
      system: 'You are the mayor of Software City. Return valid JSON only.',
      prompt,
      temperature: 0.2,
      maxTokens: 600,
    });
  }

  private async callMayorAI(briefing: CityBriefing): Promise<OrchestratorDirective> {
    const settings = await this.getSettings();
    const provider = settings.orchestrator_model ?? 'groq';
    this.model = provider;
    const prompt = buildOrchestratorPrompt(briefing);

    try {
      let responseText: string;

      if (provider === 'groq' && process.env['GROQ_API_KEY']) {
        responseText = await this.callGroq(prompt, settings.groq_model);
      } else if (provider === 'openrouter' && process.env['OPENROUTER_API_KEY']) {
        responseText = await this.callOpenRouter(prompt, settings.openrouter_model);
      } else if (provider === 'ollama') {
        responseText = await this.callOllama(prompt, settings.ollama_fast_model);
      } else {
        return this.ruleBasedDirective(briefing);
      }

      return this.parseDirective(responseText, briefing);
    } catch {
      return this.ruleBasedDirective(briefing);
    }
  }

  private ruleBasedDirective(b: CityBriefing): OrchestratorDirective {
    const targets = [
      ...b.fireBuildings,
      ...b.highComplexity,
    ].slice(0, b.activeAgents + b.idleAgents);
    return {
      priority_targets: targets,
      agent_assignments: [],
      bulletin_message: b.fireBuildings.length > 0
        ? `${b.fireBuildings.length} buildings on fire. Dispatching agents.`
        : `Health: ${b.healthScore}%. Focusing on ${b.untestedBuildings} untested files.`,
      escalate_architectural: false,
      reasoning: 'Rule-based (no AI available)',
    };
  }

  private async executeDirective(d: OrchestratorDirective): Promise<void> {
    // Update priority queue for agentEngine
    // Use (global as any) to avoid TS index signature error
    if (typeof (global as any).setPriorityTargets === 'function') {
      await (global as any).setPriorityTargets(d.priority_targets);
    }
    // Agent assignments (future)
    // ...
  }

  getLastDirective(): OrchestratorDirective | null {
    return this.lastDirective;
  }

  getNextRunIn(): number {
    return Math.max(0, this.nextRun - Date.now());
  }

  getModel(): string {
    return this.model;
  }
}

export const orchestrator = new Orchestrator();
