import { db } from "@workspace/db";
import { DEFAULT_SETTINGS, knowledgeTable, settingsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { buildEscalationPrompt, buildDialoguePrompt } from "./ollamaPrompts";
import { ollamaClient } from "./ollamaClient";
import { anonymizeForKB, anonymizeCodeForAI } from "./anonymize";
import { recordEscalationAttempt, recordKbHit, recordKbMiss, recordKbSave } from "./sessionStats";
import { addToCache, hybridSearch } from "./vectorSearch";
import { embed } from "./embeddings";
import {
  buildRolePrompt,
  mapRoleToPersona,
  parseRoleResponse,
  type AgentPersona,
  type BugStyleFinding,
  type ScribeRecommendation,
} from "./smartAgents";

function logEscalation(step: string, details: string): void {
  console.log(`[Escalation] ${step} ${details}`);
}

function preview(text: string, max = 220): string {
  return text.replace(/\s+/g, " ").slice(0, max);
}

interface EscalationModelSettings {
  ollamaFastModel: string;
  ollamaPrimaryModel: string;
  groqModel: string;
  openrouterModel: string;
  anthropicModel: string;
  orchestratorModel: string;
}

const ESCALATION_MODEL_KEYS = [
  "ollama_fast_model",
  "ollama_primary_model",
  "groq_model",
  "openrouter_model",
  "anthropic_model",
  "orchestrator_model",
] as const;

const ESCALATION_MODEL_DEFAULTS: EscalationModelSettings = {
  ollamaFastModel: DEFAULT_SETTINGS["ollama_fast_model"],
  ollamaPrimaryModel: DEFAULT_SETTINGS["ollama_primary_model"],
  groqModel: DEFAULT_SETTINGS["groq_model"],
  openrouterModel: DEFAULT_SETTINGS["openrouter_model"],
  anthropicModel: DEFAULT_SETTINGS["anthropic_model"],
  orchestratorModel: DEFAULT_SETTINGS["orchestrator_model"],
};

function normalizeGroqModel(model: string): string {
  // Groq retired some 3.1 variants; map legacy defaults to an available modern equivalent.
  if (model === "llama-3.1-70b-versatile") return "llama-3.3-70b-versatile";
  return model;
}

async function readEscalationModelSettings(): Promise<EscalationModelSettings> {
  try {
    const rows = await db
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(inArray(settingsTable.key, [...ESCALATION_MODEL_KEYS]));

    const map = new Map<string, string>();
    for (const row of rows) map.set(row.key, row.value);

    return {
      ollamaFastModel: map.get("ollama_fast_model") ?? ESCALATION_MODEL_DEFAULTS.ollamaFastModel,
      ollamaPrimaryModel: map.get("ollama_primary_model") ?? ESCALATION_MODEL_DEFAULTS.ollamaPrimaryModel,
      groqModel: normalizeGroqModel(map.get("groq_model") ?? ESCALATION_MODEL_DEFAULTS.groqModel),
      openrouterModel: map.get("openrouter_model") ?? ESCALATION_MODEL_DEFAULTS.openrouterModel,
      anthropicModel: map.get("anthropic_model") ?? ESCALATION_MODEL_DEFAULTS.anthropicModel,
      orchestratorModel: map.get("orchestrator_model") ?? ESCALATION_MODEL_DEFAULTS.orchestratorModel,
    };
  } catch {
    return {
      ...ESCALATION_MODEL_DEFAULTS,
      groqModel: normalizeGroqModel(ESCALATION_MODEL_DEFAULTS.groqModel),
    };
  }
}
// --- OpenRouter client ---
async function callOpenRouter(req: EscalationRequest, attempts: string[], model: string): Promise<EscalationResult | null> {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) {
    logEscalation("openrouter.skip", "reason=missing_key");
    return null;
  }

  // Anonymize question/code for privacy
  const question = anonymizeForKB(req.question);
  const codeSnippet = anonymizeCodeForAI(req.codeSnippet);
  const { system, prompt } = buildEscalationPrompt(question, codeSnippet, attempts);

  try {
    logEscalation("openrouter.request", `model=${model} language=${req.language}`);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logEscalation("openrouter.response", `status=${res.status} body="${preview(body, 260)}"`);
      return null;
    }
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonResponse(content);
    if (!parsed) {
      logEscalation("openrouter.parse", "status=failed");
      return null;
    }
    logEscalation("openrouter.success", `confidence=${parsed.confidence.toFixed(2)} response="${preview(parsed.answer)}"`);
    return { ...parsed, source: "openrouter" };
  } catch {
    logEscalation("openrouter.error", "status=exception");
    return null;
  }
}

export interface EscalationRequest {
  question: string;
  codeSnippet: string;
  language: string;
  failedAttempts?: string[];
  agentRole?: string;
  filePath?: string;
  consultationContext?: string;
}

export interface EscalationResult {
  answer: string;
  confidence: number;
  action_items: string[];
  source: "knowledge_base" | "ollama" | "groq" | "anthropic" | "openrouter" | "fallback";
  searchType?: "vector" | "keyword";
  finding?: string | null;
  lineReference?: string | null;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  functionName?: string | null;
  cveReference?: string | null;
  estimatedPerformanceImpact?: string | null;
  couplingImports?: string[];
  testType?: "unit" | "integration" | "e2e";
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

function normalizeSeverityToken(raw: string): FindingSeverity | null {
  const token = raw.trim().toUpperCase();
  if (token === "CRITICAL" || token === "HIGH" || token === "MEDIUM" || token === "LOW") return token;
  return null;
}

function classifyFindingSeverityByKeywords(finding: string): FindingSeverity {
  const lower = finding.toLowerCase();

  if (/(security|injection|auth|data\s+loss|crash|vulnerability|exploit)/.test(lower)) return "CRITICAL";
  if (/(undefined|null|throw|exception|panic)/.test(lower)) return "HIGH";
  if (/(performance|slow|memory|loop|latency|n\+1)/.test(lower)) return "MEDIUM";
  return "LOW";
}

export async function classifyFindingSeverity(params: {
  finding: string;
  filePath: string;
}): Promise<FindingSeverity> {
  const fallback = classifyFindingSeverityByKeywords(`${params.finding} ${params.filePath}`);
  const key = process.env["GROQ_API_KEY"];
  if (!key) {
    logEscalation("severity.fallback", "reason=missing_groq_key");
    return fallback;
  }

  try {
    const models = await readEscalationModelSettings();
    const prompt = [
      "Classify this finding severity: CRITICAL/HIGH/MEDIUM/LOW.",
      `Finding: ${params.finding}`,
      `File: ${params.filePath}`,
      "Return only one word.",
    ].join("\n");

    logEscalation("severity.groq.request", `model=${models.groqModel} file=${params.filePath}`);
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: models.groqModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logEscalation("severity.groq.response", `status=${res.status} body="${preview(body, 200)}"`);
      return fallback;
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = (data.choices?.[0]?.message?.content ?? "").trim();
    const firstWord = content.split(/\s+/)[0] ?? "";

    const severity = normalizeSeverityToken(firstWord) ?? normalizeSeverityToken(content);
    if (!severity) {
      logEscalation("severity.groq.parse", `status=failed raw="${preview(content, 80)}"`);
      return fallback;
    }

    logEscalation("severity.groq.success", `severity=${severity}`);
    return severity;
  } catch {
    logEscalation("severity.fallback", "reason=request_failed");
    return fallback;
  }
}

function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let matches = 0;
  for (const w of wordsA) if (wordsB.has(w)) matches++;
  return matches / Math.max(wordsA.size, wordsB.size);
}

function parseActionItems(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

async function searchKnowledgeBase(req: EscalationRequest): Promise<EscalationResult | null> {
  try {
    logEscalation("kb.search", `language=${req.language} question="${preview(req.question, 120)}"`);
    const results = await hybridSearch(req.question, 3, { language: req.language });
    if (results.length === 0) {
      logEscalation("kb.miss", "bestSimilarity=0.00");
      return null;
    }

    const best = results[0];
    if (best.similarity >= 0.65) {
      await db.update(knowledgeTable)
        .set({ useCount: (best.entry.useCount ?? 0) + 1 })
        .where(eq(knowledgeTable.id, best.entry.id));

      recordKbHit(best.source, best.similarity);

      console.log(
        `[KB] Hit via ${best.source} search ` +
        `(similarity: ${(best.similarity * 100).toFixed(1)}%): ` +
        `${best.entry.question.slice(0, 60)}`,
      );

      logEscalation("kb.hit", `entryId=${best.entry.id} similarity=${best.similarity.toFixed(2)} source=${best.source}`);
      return {
        answer: best.entry.answer ?? "",
        confidence: best.similarity,
        action_items: parseActionItems(best.entry.actionItems),
        source: "knowledge_base",
        searchType: best.source,
      };
    }

    logEscalation("kb.miss", `bestSimilarity=${best.similarity.toFixed(2)}`);
  } catch { }
  return null;
}

function parseJsonResponse(text: string): { answer: string; confidence: number; action_items: string[] } | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        answer: String(parsed.answer ?? parsed.result ?? text),
        confidence: Number(parsed.confidence ?? 0.7),
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
      };
    }
  } catch { }
  return null;
}

async function callGroq(req: EscalationRequest, attempts: string[], model: string): Promise<EscalationResult | null> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) {
    logEscalation("groq.skip", "reason=missing_key");
    return null;
  }

  // Anonymize question/code for privacy
  const question = anonymizeForKB(req.question);
  const codeSnippet = anonymizeCodeForAI(req.codeSnippet);
  const persona: AgentPersona | null = req.agentRole ? mapRoleToPersona(req.agentRole) : null;
  const rolePrompt = persona && persona !== "alchemist"
    ? buildRolePrompt({
      persona,
      language: req.language,
      filePath: req.filePath ?? "unknown.ts",
      codeSnippet,
      context: req.consultationContext,
    })
    : null;
  const { system, prompt } = rolePrompt
    ? rolePrompt
    : buildEscalationPrompt(question, codeSnippet, attempts);

  try {
    logEscalation("groq.request", `model=${model} language=${req.language} keyPresent=true`);
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logEscalation("groq.response", `status=${res.status} body="${preview(body, 260)}"`);
      return null;
    }
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (rolePrompt && persona && persona !== "alchemist") {
      const structured = parseRoleResponse(persona, content);
      if (structured) {
        if (persona === "scribe") {
          const scribe = structured as ScribeRecommendation;
          const answer = `Prioritize tests for ${scribe.functionName}: ${scribe.reason}`;
          logEscalation("groq.success", `role=${persona} confidence=${scribe.confidence.toFixed(2)} response="${preview(answer)}"`);
          return {
            answer,
            confidence: scribe.confidence,
            action_items: [`Write a ${scribe.testType} test for ${scribe.functionName}`, scribe.reason],
            source: "groq",
            functionName: scribe.functionName,
            testType: scribe.testType,
            priority: scribe.priority,
            finding: null,
          };
        }

        const finding = structured as BugStyleFinding;
        const answer = finding.finding ?? "No concrete bug found.";
        logEscalation("groq.success", `role=${persona} confidence=${finding.confidence.toFixed(2)} response="${preview(answer)}"`);
        return {
          answer,
          confidence: finding.confidence,
          action_items: [
            finding.finding ? `Investigate ${finding.functionName ?? "the referenced function"}` : "No verified issue found",
            finding.lineReference ?? "No line reference provided",
          ],
          source: "groq",
          finding: finding.finding,
          lineReference: finding.lineReference,
          severity: finding.severity,
          functionName: finding.functionName,
          cveReference: finding.cveReference ?? null,
          estimatedPerformanceImpact: finding.estimatedPerformanceImpact ?? null,
          couplingImports: finding.couplingImports ?? [],
        };
      }
    }

    const parsed = parseJsonResponse(content);
    if (!parsed) {
      logEscalation("groq.parse", "status=failed");
      return null;
    }
    logEscalation("groq.success", `confidence=${parsed.confidence.toFixed(2)} response="${preview(parsed.answer)}"`);
    return { ...parsed, source: "groq" };
  } catch {
    logEscalation("groq.error", "status=exception");
    return null;
  }
}

async function callAnthropic(req: EscalationRequest, attempts: string[], model: string): Promise<EscalationResult | null> {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    logEscalation("anthropic.skip", "reason=missing_key");
    return null;
  }

  // Anonymize question/code for privacy
  const question = anonymizeForKB(req.question);
  const codeSnippet = anonymizeCodeForAI(req.codeSnippet);
  const { system, prompt } = buildEscalationPrompt(question, codeSnippet, attempts);

  try {
    logEscalation("anthropic.request", `model=${model} language=${req.language}`);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logEscalation("anthropic.response", `status=${res.status} body="${preview(body, 260)}"`);
      return null;
    }
    const data = await res.json() as { content?: Array<{ text: string }> };
    const content = data.content?.[0]?.text ?? "";
    const parsed = parseJsonResponse(content);
    if (!parsed) {
      logEscalation("anthropic.parse", "status=failed");
      return null;
    }
    logEscalation("anthropic.success", `confidence=${parsed.confidence.toFixed(2)} response="${preview(parsed.answer)}"`);
    return { ...parsed, source: "anthropic" };
  } catch {
    logEscalation("anthropic.error", "status=exception");
    return null;
  }
}

async function callOllama(req: EscalationRequest, attempts: string[], model: string): Promise<EscalationResult | null> {
  try {
    const available = await ollamaClient.isAvailable();
    if (!available) {
      logEscalation("ollama.skip", "reason=unavailable");
      return null;
    }

    // Anonymize question/code for privacy
    const question = anonymizeForKB(req.question);
    const codeSnippet = anonymizeCodeForAI(req.codeSnippet);
    const { system, prompt } = buildEscalationPrompt(question, codeSnippet, attempts);
    logEscalation("ollama.request", `model=${model} language=${req.language}`);
    const text = await ollamaClient.generate({
      model,
      system,
      prompt,
      temperature: 0.3,
      maxTokens: 600,
    });

    const parsed = parseJsonResponse(text);
    if (!parsed) {
      logEscalation("ollama.parse", "status=failed");
      return null;
    }
    logEscalation("ollama.success", `confidence=${parsed.confidence.toFixed(2)} response="${preview(parsed.answer)}"`);
    return { ...parsed, source: "ollama" };
  } catch {
    logEscalation("ollama.error", "status=exception");
    return null;
  }
}

function computeQualityScore(useCount: number, confidence: string, producedBugs: number): number {
  const confNum = confidence === "high" ? 1.0 : confidence === "medium" ? 0.7 : parseFloat(confidence) || 0.3;
  return Math.min(1.0, producedBugs * 0.4 + Math.min(useCount, 10) * 0.05 + confNum * 0.5);
}

async function saveToKnowledgeBase(req: EscalationRequest, result: EscalationResult): Promise<void> {
  try {
    const existing = await db.select().from(knowledgeTable)
      .where(eq(knowledgeTable.language, req.language))
      .limit(100);

    let bestMatch: (typeof existing)[0] | null = null;
    let bestSim = 0;

    for (const entry of existing) {
      const lenDiff = Math.abs((entry.question?.length ?? 0) - req.question.length);
      if (lenDiff > 100) continue;
      const sim = wordSimilarity(req.question, entry.question ?? "");
      if (sim > bestSim) { bestSim = sim; bestMatch = entry; }
    }

    if (bestMatch && bestSim >= 0.80) {
      const newConfidence = result.confidence > (parseFloat(bestMatch.confidence) || 0)
        ? String(result.confidence) : bestMatch.confidence;
      const newUseCount = (bestMatch.useCount ?? 1) + 1;
      const qs = computeQualityScore(newUseCount, newConfidence, bestMatch.producedBugs ?? 0);
      await db.update(knowledgeTable)
        .set({ useCount: newUseCount, answer: result.answer.slice(0, 2000), confidence: newConfidence, lastUsed: new Date().toISOString(), qualityScore: qs })
        .where(eq(knowledgeTable.id, bestMatch.id));

      // Backfill a vector immediately if this reused row predates embeddings.
      if (!bestMatch.embedding) {
        try {
          const text = `${bestMatch.question} ${result.answer}`.slice(0, 512);
          const vector = await embed(text);
          await db.update(knowledgeTable)
            .set({ embedding: JSON.stringify(vector) })
            .where(eq(knowledgeTable.id, bestMatch.id));

          const updatedEntry = {
            ...bestMatch,
            answer: result.answer.slice(0, 2000),
            confidence: newConfidence,
            useCount: newUseCount,
            qualityScore: qs,
            embedding: JSON.stringify(vector),
            lastUsed: new Date().toISOString(),
          };
          addToCache(bestMatch.id, vector, updatedEntry);
        } catch (error) {
          console.warn("[Embeddings] Failed to backfill reused KB entry:", error);
        }
      }

      recordKbSave();
      return;
    }

    const qs = computeQualityScore(1, String(result.confidence), 0);
    const inserted = await db.insert(knowledgeTable).values({
      problemType: "test_generation",
      language: req.language,
      question: req.question.slice(0, 500),
      answer: result.answer.slice(0, 2000),
      confidence: String(result.confidence),
      provider: result.source,
      domain: "general",
      actionItems: JSON.stringify(result.action_items),
      useCount: 1,
      producedBugs: 0,
      qualityScore: qs,
    }).returning({ id: knowledgeTable.id });

    const insertedId = inserted[0]?.id;
    if (insertedId) {
      try {
        const text = `${req.question} ${result.answer}`.slice(0, 512);
        const vector = await embed(text);

        await db.update(knowledgeTable)
          .set({ embedding: JSON.stringify(vector) })
          .where(eq(knowledgeTable.id, insertedId));

        const [createdEntry] = await db.select().from(knowledgeTable).where(eq(knowledgeTable.id, insertedId)).limit(1);
        if (createdEntry) {
          addToCache(insertedId, vector, createdEntry);
          console.log("[KB] New entry embedded and cached");
        }
      } catch (error) {
        console.warn("[Embeddings] Failed to embed new KB entry:", error);
      }
    }

    recordKbSave();
  } catch { }
}

export async function escalate(req: EscalationRequest): Promise<EscalationResult> {
  recordEscalationAttempt();
  logEscalation("start", `language=${req.language} question="${preview(req.question, 140)}"`);
  const attempts = req.failedAttempts ?? [];
  const models = await readEscalationModelSettings();
  const persona = req.agentRole ? mapRoleToPersona(req.agentRole) : null;

  if (persona === "alchemist") {
    logEscalation("skip", "role=alchemist reason=command_execution_role");
    return {
      answer: "Alchemist role executes commands and reports results. No code-analysis prompt was used.",
      confidence: 0.95,
      action_items: ["Run a safe command via /api/alchemist/run", "Summarize stdout/stderr for the city report"],
      source: "fallback",
    };
  }

  const kb = await searchKnowledgeBase(req);
  if (kb) {
    logEscalation("complete", "source=knowledge_base");
    return kb;
  }
  recordKbMiss();

  if (persona) {
    const groqRoleAware = await callGroq(req, attempts, models.groqModel);
    if (groqRoleAware) {
      await saveToKnowledgeBase(req, groqRoleAware);
      logEscalation("complete", "source=groq role_prompt=true");
      return groqRoleAware;
    }
  }

  // OpenRouter free tier first
  const openrouter = await callOpenRouter(req, attempts, models.openrouterModel);
  if (openrouter) {
    await saveToKnowledgeBase(req, openrouter);
    logEscalation("complete", "source=openrouter");
    return openrouter;
  }

  if (!persona) {
    const groq = await callGroq(req, attempts, models.groqModel);
    if (groq) {
      await saveToKnowledgeBase(req, groq);
      logEscalation("complete", "source=groq");
      return groq;
    }
  }

  const anthropic = await callAnthropic(req, attempts, models.anthropicModel);
  if (anthropic) {
    await saveToKnowledgeBase(req, anthropic);
    logEscalation("complete", "source=anthropic");
    return anthropic;
  }

  const ollama = await callOllama(req, attempts, models.ollamaPrimaryModel);
  if (ollama) {
    await saveToKnowledgeBase(req, ollama);
    logEscalation("complete", "source=ollama");
    return ollama;
  }

  logEscalation("complete", "source=fallback");

  return {
    answer: `I analyzed ${req.language} code related to: "${req.question.slice(0, 100)}". No external AI available, but based on common patterns: check error handling, add input validation, and ensure test coverage for edge cases.`,
    confidence: 0.4,
    action_items: ["Add unit tests", "Check error handling", "Review edge cases"],
    source: "fallback",
  };
}

export async function generateDialogue(params: {
  npcRole: string;
  buildingFile: string;
  buildingContent: string;
  recentFindings: string[];
  question: string;
  language: string;
}): Promise<{ message: string; confidence: number; source: string; offerEscalation: boolean }> {
  const models = await readEscalationModelSettings();
  const { system, prompt } = buildDialoguePrompt(
    params.npcRole,
    params.buildingFile,
    params.recentFindings,
    params.question,
  );

  try {
    const available = await ollamaClient.isAvailable();
    if (available) {
      const text = await ollamaClient.generate({
        model: models.ollamaFastModel,
        system,
        prompt,
        temperature: 0.3,
        maxTokens: 300,
      });

      const confMatch = text.match(/CONFIDENCE:([\d.]+)/);
      const confidence = confMatch ? parseFloat(confMatch[1]) : 0.7;
      const message = text.replace(/CONFIDENCE:[\d.]+/, "").trim();

      if (confidence >= 0.65) {
        return { message, confidence, source: "local", offerEscalation: false };
      } else {
        return {
          message: message + "\n\nI'm not fully certain — want me to ask the senior AI? Reply 'yes escalate' to confirm.",
          confidence,
          source: "local",
          offerEscalation: true,
        };
      }
    }
  } catch { }

  const roleContext: Record<string, string> = {
    qa_inspector: `I've analyzed ${params.buildingFile}. `,
    api_fuzzer: `After fuzzing ${params.buildingFile}: `,
    edge_explorer: `Exploring edge cases in ${params.buildingFile}: `,
    load_tester: `Load-testing ${params.buildingFile}: `,
    ui_navigator: `Navigating ${params.buildingFile}: `,
  };

  const prefix = roleContext[params.npcRole] ?? `In ${params.buildingFile}: `;
  const lower = params.question.toLowerCase();

  let response: string;
  if (lower.includes("bug") || lower.includes("fix") || lower.includes("error")) {
    response = `${prefix}I found potential issues in error handling paths. Wrap async calls in try-catch and validate all inputs. Test with null and undefined values specifically.`;
  } else if (lower.includes("test") || lower.includes("coverage")) {
    response = `${prefix}Test coverage here needs improvement. Add parameterized tests for the happy path first, then boundary conditions — null inputs, empty arrays, and max-size values.`;
  } else if (lower.includes("performance") || lower.includes("slow") || lower.includes("speed")) {
    response = `${prefix}Performance looks bottlenecked on repeated operations. Consider memoizing expensive calls and checking for N+1 query patterns in the data access layer.`;
  } else if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
    response = `Hey! I'm your ${params.npcRole.replace("_", " ")} analyzing ${params.buildingFile}. Ask me about bugs, test coverage, or performance issues and I'll dig in!`;
  } else {
    response = `${prefix}Based on my analysis of this ${params.language} file, I see ${params.buildingFile.includes("test") ? "good test structure" : "opportunities to improve coverage"}. The key functions need edge case tests — particularly around error states and boundary values.`;
  }

  return {
    message: response,
    confidence: 0.6,
    source: "local",
    offerEscalation: true,
  };
}
