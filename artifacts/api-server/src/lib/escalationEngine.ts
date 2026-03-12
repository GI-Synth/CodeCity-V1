import { db } from "@workspace/db";
import { knowledgeTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { buildEscalationPrompt, buildDialoguePrompt } from "./ollamaPrompts";
import { ollamaClient } from "./ollamaClient";

export interface EscalationRequest {
  question: string;
  codeSnippet: string;
  language: string;
  failedAttempts?: string[];
}

export interface EscalationResult {
  answer: string;
  confidence: number;
  action_items: string[];
  source: "knowledge_base" | "ollama" | "groq" | "anthropic" | "fallback";
}

function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let matches = 0;
  for (const w of wordsA) if (wordsB.has(w)) matches++;
  return matches / Math.max(wordsA.size, wordsB.size);
}

async function searchKnowledgeBase(req: EscalationRequest): Promise<EscalationResult | null> {
  try {
    const entries = await db.select().from(knowledgeTable)
      .where(eq(knowledgeTable.language, req.language))
      .limit(50);

    let best: (typeof entries)[0] | null = null;
    let bestSim = 0;

    for (const entry of entries) {
      const sim = wordSimilarity(req.question, entry.question ?? "");
      if (sim > bestSim) { bestSim = sim; best = entry; }
    }

    if (best && bestSim >= 0.65) {
      await db.update(knowledgeTable)
        .set({ useCount: (best.useCount ?? 0) + 1 })
        .where(eq(knowledgeTable.id, best.id));

      const confidenceNum = parseFloat(best.confidence ?? "0.7");
      return {
        answer: best.answer ?? "",
        confidence: isNaN(confidenceNum) ? 0.7 : confidenceNum,
        action_items: best.actionItems ? (() => { try { return JSON.parse(best.actionItems!); } catch { return []; } })() : [],
        source: "knowledge_base",
      };
    }
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

async function callGroq(req: EscalationRequest, attempts: string[]): Promise<EscalationResult | null> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) return null;

  const { system, prompt } = buildEscalationPrompt(req.question, req.codeSnippet, attempts);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: 600,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonResponse(content);
    if (!parsed) return null;
    return { ...parsed, source: "groq" };
  } catch {
    return null;
  }
}

async function callAnthropic(req: EscalationRequest, attempts: string[]): Promise<EscalationResult | null> {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) return null;

  const { system, prompt } = buildEscalationPrompt(req.question, req.codeSnippet, attempts);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        system,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { content?: Array<{ text: string }> };
    const content = data.content?.[0]?.text ?? "";
    const parsed = parseJsonResponse(content);
    if (!parsed) return null;
    return { ...parsed, source: "anthropic" };
  } catch {
    return null;
  }
}

async function callOllama(req: EscalationRequest, attempts: string[]): Promise<EscalationResult | null> {
  try {
    const available = await ollamaClient.isAvailable();
    if (!available) return null;

    const { system, prompt } = buildEscalationPrompt(req.question, req.codeSnippet, attempts);
    const text = await ollamaClient.generate({
      model: "deepseek-coder-v2:16b",
      system,
      prompt,
      temperature: 0.3,
      maxTokens: 600,
    });

    const parsed = parseJsonResponse(text);
    if (!parsed) return null;
    return { ...parsed, source: "ollama" };
  } catch {
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
        .set({ useCount: newUseCount, answer: result.answer.slice(0, 2000), confidence: newConfidence, lastUsed: new Date(), qualityScore: qs })
        .where(eq(knowledgeTable.id, bestMatch.id));
      return;
    }

    const qs = computeQualityScore(1, String(result.confidence), 0);
    await db.insert(knowledgeTable).values({
      problemType: "test_generation",
      language: req.language,
      question: req.question.slice(0, 500),
      answer: result.answer.slice(0, 2000),
      confidence: String(result.confidence),
      provider: result.source,
      actionItems: JSON.stringify(result.action_items),
      useCount: 1,
      producedBugs: 0,
      qualityScore: qs,
    });
  } catch { }
}

export async function escalate(req: EscalationRequest): Promise<EscalationResult> {
  const attempts = req.failedAttempts ?? [];

  const kb = await searchKnowledgeBase(req);
  if (kb) return kb;

  const groq = await callGroq(req, attempts);
  if (groq) {
    await saveToKnowledgeBase(req, groq);
    return groq;
  }

  const anthropic = await callAnthropic(req, attempts);
  if (anthropic) {
    await saveToKnowledgeBase(req, anthropic);
    return anthropic;
  }

  const ollama = await callOllama(req, attempts);
  if (ollama) {
    await saveToKnowledgeBase(req, ollama);
    return ollama;
  }

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
        model: "deepseek-coder:6.7b",
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
