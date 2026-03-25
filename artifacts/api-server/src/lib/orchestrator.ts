import { wsServer } from './wsServer';
import { db } from '@workspace/db';
import { DEFAULT_SETTINGS, agentsTable, eventsTable, findingsTable, knowledgeTable, reposTable, settingsTable } from '@workspace/db/schema';
import { buildOrchestratorPrompt } from './orchestratorPrompts';
import { desc, inArray, eq, gte, sql } from 'drizzle-orm';
import { ollamaClient } from './ollamaClient';
import { mayorRespond } from './agentMessageBus';
import { getErrorHotspots } from './consoleLogAgent';
import { chat } from './providers/router';

const ORCHESTRATOR_INTERVAL_MS = 60000;
const ORCHESTRATOR_SETTING_KEYS = [
  'orchestrator_model',
  'groq_model',
  'openrouter_model',
  'ollama_fast_model',
  'ollama_primary_model',
] as const;

interface OrchestratorSettings {
  orchestrator_model: string;
  groq_model: string;
  openrouter_model: string;
  ollama_fast_model: string;
  ollama_primary_model: string;
  ollama_primary_model_explicit: boolean;
}

const ORCHESTRATOR_SETTING_DEFAULTS: OrchestratorSettings = {
  orchestrator_model: DEFAULT_SETTINGS['orchestrator_model'] ?? 'groq',
  groq_model: DEFAULT_SETTINGS['groq_model'] ?? 'llama-3.3-70b-versatile',
  openrouter_model: DEFAULT_SETTINGS['openrouter_model'] ?? 'openrouter/codellama-70b',
  ollama_fast_model: DEFAULT_SETTINGS['ollama_fast_model'] ?? 'deepseek-coder:6.7b',
  ollama_primary_model: DEFAULT_SETTINGS['ollama_primary_model'] ?? 'deepseek-coder-v2:16b',
  ollama_primary_model_explicit: false,
};

const MAYOR_OLLAMA_FALLBACK_MODELS = [
  'qwen2.5:0.5b',
  'qwen2.5:1.5b',
  'tinyllama:1.1b',
  'smollm2:360m',
  'smollm2:135m',
] as const;

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

/** Strategic modes that change the Mayor's focus each cycle. */
export type MayorStrategicMode = "triage" | "improvement" | "security" | "architecture" | "learning";

/** Enhanced recommendation format per the master plan. */
export interface MayorRecommendation {
  finding: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  evidence: string[];
  specificFix: string;
  risk: string;
  estimatedEffort: string;
  impact: string;
}

/** Extra intelligence the Mayor has access to beyond basic briefing. */
export interface MayorIntelligence {
  errorHotspots: { file: string; count: number }[];
  recentFindings: { classification: string; filePath: string; finding: string }[];
  healthTrend: "improving" | "stable" | "degrading";
}

class Orchestrator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastDirective: OrchestratorDirective | null = null;
  private nextRun: number = Date.now();
  private model: string = ORCHESTRATOR_SETTING_DEFAULTS.orchestrator_model;
  private strategicMode: MayorStrategicMode = "improvement";
  private previousHealthScore: number | null = null;
  private lastRecommendations: MayorRecommendation[] = [];

  start(): void {
    this.intervalId = setInterval(() => this.think(), ORCHESTRATOR_INTERVAL_MS);
    setTimeout(() => this.think(), 5000);
    this.nextRun = Date.now() + ORCHESTRATOR_INTERVAL_MS;
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  /** Allow external code (routes, Mayor Chat) to set the strategic mode. */
  setStrategicMode(mode: MayorStrategicMode): void {
    this.strategicMode = mode;
    console.log(`[Orchestrator] Strategic mode set to: ${mode}`);
  }

  getStrategicMode(): MayorStrategicMode {
    return this.strategicMode;
  }

  getLastRecommendations(): MayorRecommendation[] {
    return this.lastRecommendations;
  }

  private async think(): Promise<void> {
    try {
      const briefing = await this.buildCityBriefing();
      const intelligence = await this.gatherIntelligence(briefing);

      // Auto-select strategic mode based on city state
      this.autoSelectMode(briefing, intelligence);

      const directive = await this.callMayorAI(briefing);
      await this.executeDirective(directive);
      this.lastDirective = directive;

      // Publish Mayor's bulletin to the message bus
      mayorRespond(
        `[${this.strategicMode.toUpperCase()} MODE] ${directive.bulletin_message}`,
      ).catch(() => {});

      wsServer.broadcastEventLog('ORCHESTRATOR', directive.bulletin_message, 'info');
      this.previousHealthScore = briefing.healthScore;
      this.nextRun = Date.now() + ORCHESTRATOR_INTERVAL_MS;
    } catch (err) {
      console.warn('[Orchestrator] Think cycle failed:', err);
    }
  }

  /** Automatically select the best strategic mode based on city state. */
  private autoSelectMode(briefing: CityBriefing, intel: MayorIntelligence): void {
    // Triage: fires or lots of runtime errors
    if (briefing.fireBuildings.length > 0 || intel.errorHotspots.length >= 3) {
      this.strategicMode = "triage";
      return;
    }

    // Security: many security findings pending
    const secFindings = intel.recentFindings.filter(f =>
      f.finding.toLowerCase().includes("security") ||
      f.finding.toLowerCase().includes("inject") ||
      f.finding.toLowerCase().includes("xss") ||
      f.finding.toLowerCase().includes("auth"),
    );
    if (secFindings.length >= 3) {
      this.strategicMode = "security";
      return;
    }

    // Architecture: circular deps / coupling issues
    const archFindings = intel.recentFindings.filter(f =>
      f.finding.toLowerCase().includes("circular") ||
      f.finding.toLowerCase().includes("coupling") ||
      f.finding.toLowerCase().includes("god"),
    );
    if (archFindings.length >= 2) {
      this.strategicMode = "architecture";
      return;
    }

    // Degrading health → improvement
    if (intel.healthTrend === "degrading") {
      this.strategicMode = "improvement";
      return;
    }

    // Default: cycle between improvement and learning
    if (this.strategicMode === "improvement") {
      this.strategicMode = "learning";
    } else {
      this.strategicMode = "improvement";
    }
  }

  /** Gather extended intelligence for the Mayor. */
  private async gatherIntelligence(briefing: CityBriefing): Promise<MayorIntelligence> {
    let errorHotspots: { file: string; count: number }[] = [];
    let recentFindingRows: { classification: string | null; filePath: string; finding: string | null }[] = [];

    try {
      errorHotspots = await getErrorHotspots(30, 10);
    } catch { /* ignore */ }

    try {
      recentFindingRows = await db.select({
        classification: findingsTable.classification,
        filePath: findingsTable.filePath,
        finding: findingsTable.finding,
      })
        .from(findingsTable)
        .where(gte(findingsTable.createdAt, new Date(Date.now() - 3_600_000).toISOString()))
        .orderBy(desc(findingsTable.createdAt))
        .limit(20);
    } catch { /* ignore */ }

    const recentFindings = recentFindingRows
      .filter((r): r is { classification: string; filePath: string; finding: string } => r.classification != null && r.finding != null)
      .map(r => ({ classification: r.classification, filePath: r.filePath, finding: r.finding }));

    let healthTrend: "improving" | "stable" | "degrading" = "stable";
    if (this.previousHealthScore != null) {
      const delta = briefing.healthScore - this.previousHealthScore;
      if (delta > 2) healthTrend = "improving";
      else if (delta < -2) healthTrend = "degrading";
    }

    return { errorHotspots, recentFindings, healthTrend };
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

      const configuredPrimaryModel = map.get('ollama_primary_model')?.trim();
      const resolvedPrimaryModel = configuredPrimaryModel && configuredPrimaryModel.length > 0
        ? configuredPrimaryModel
        : ORCHESTRATOR_SETTING_DEFAULTS.ollama_primary_model;
      const primaryModelExplicitlySet = Boolean(
        configuredPrimaryModel
        && configuredPrimaryModel.length > 0
        && configuredPrimaryModel !== ORCHESTRATOR_SETTING_DEFAULTS.ollama_primary_model
      );

      return {
        orchestrator_model: map.get('orchestrator_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.orchestrator_model,
        groq_model: map.get('groq_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.groq_model,
        openrouter_model: map.get('openrouter_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.openrouter_model,
        ollama_fast_model: map.get('ollama_fast_model') ?? ORCHESTRATOR_SETTING_DEFAULTS.ollama_fast_model,
        ollama_primary_model: resolvedPrimaryModel,
        ollama_primary_model_explicit: primaryModelExplicitlySet,
      };
    } catch {
      return ORCHESTRATOR_SETTING_DEFAULTS;
    }
  }

  private parseDirective(responseText: string, briefing: CityBriefing): OrchestratorDirective {
    const fallback = this.ruleBasedDirective(briefing);

    const recoverFromText = (): OrchestratorDirective | null => {
      const targetMatches = responseText.match(/\bbuilding-[A-Za-z0-9_-]+\b/g) ?? [];
      const priorityTargets = Array.from(new Set(targetMatches)).slice(0, 50);
      if (priorityTargets.length === 0) return null;

      const compact = responseText.replace(/\s+/g, ' ').trim();
      const sentence = compact.split(/[.!?]/)[0]?.trim() ?? '';

      return {
        priority_targets: priorityTargets,
        agent_assignments: [],
        bulletin_message: sentence.length > 0 ? sentence : fallback.bulletin_message,
        escalate_architectural: /architect|cross[ -]?cut|systemic|platform/i.test(responseText),
        reasoning: 'Recovered from non-JSON mayor response',
      };
    };

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[Mayor] AI response unparseable — no JSON block found. Raw:', responseText.slice(0, 200));
        return recoverFromText() ?? fallback;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Partial<OrchestratorDirective>;
      if (!Array.isArray(parsed.priority_targets)) {
        console.warn('[Mayor] AI JSON missing priority_targets — falling back to rule-based. Raw:', responseText.slice(0, 200));
        return recoverFromText() ?? fallback;
      }

      const priorityTargets = parsed.priority_targets
        .filter((target): target is string => typeof target === 'string' && target.trim().length > 0)
        .slice(0, 50);

      if (priorityTargets.length === 0) {
        console.warn('[Mayor] AI returned empty priority_targets — falling back to rule-based. Raw:', responseText.slice(0, 200));
        return recoverFromText() ?? fallback;
      }

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
      console.warn('[Mayor] AI response parse threw exception — falling back to rule-based. Raw:', responseText.slice(0, 200));
      return recoverFromText() ?? fallback;
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
        'HTTP-Referer': 'https://software-city.local',
        'X-Title': 'Software City',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        reasoning: { exclude: true },
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter request failed (${res.status})`);
    }

    const data = await res.json() as {
      choices?: Array<{
        message?: {
          content?: unknown;
        };
      }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            return String((part as { text?: unknown }).text);
          }
          return '';
        })
        .join('\n')
        .trim();
    }
    return '';
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

  private modelMatches(candidate: string, preferred: string): boolean {
    const normalizedCandidate = candidate.toLowerCase();
    const normalizedPreferred = preferred.toLowerCase();
    if (normalizedCandidate === normalizedPreferred) return true;

    const preferredBase = normalizedPreferred.split(':')[0];
    return (
      normalizedCandidate.startsWith(`${normalizedPreferred}:`)
      || normalizedCandidate.startsWith(`${preferredBase}:`)
      || normalizedCandidate.startsWith(`${preferredBase}-`)
    );
  }

  private async selectMayorOllamaModel(settings: OrchestratorSettings): Promise<string> {
    const models = await ollamaClient.listModels();

    if (settings.ollama_primary_model_explicit) {
      const explicitModel = settings.ollama_primary_model.trim();
      if (explicitModel.length > 0) {
        const explicitMatch = models.find((model) => this.modelMatches(model, explicitModel));
        if (explicitMatch) return explicitMatch;
      }
    }

    for (const preferred of MAYOR_OLLAMA_FALLBACK_MODELS) {
      const match = models.find((model) => this.modelMatches(model, preferred));
      if (match) return match;
    }

    const auto = await ollamaClient.selectBestModel();
    return auto ?? settings.ollama_fast_model;
  }

  private async callMayorAI(briefing: CityBriefing): Promise<OrchestratorDirective> {
    const prompt = buildOrchestratorPrompt(briefing);

    try {
      const response = await chat(
        [
          { role: 'system', content: 'You are the mayor of Software City. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        'mayor',
        600,
      );

      // All providers failed — fall back to rule-based
      if (response.fallbackReason === 'all_providers_failed') {
        console.warn('[Mayor] All AI providers failed — falling back to rule-based.');
        return this.ruleBasedDirective(briefing);
      }

      this.model = `${response.provider}:${response.model}`;

      return this.parseDirective(response.content, briefing);
    } catch (err) {
      console.warn('[Mayor] AI call threw exception — falling back to rule-based:', err instanceof Error ? err.message : String(err));
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
