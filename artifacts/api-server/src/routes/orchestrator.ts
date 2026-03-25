import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  agentsTable,
  eventsTable,
  executionResultsTable,
  knowledgeTable,
  metricSnapshotsTable,
  reposTable,
  settingsTable,
  snapshotsTable,
} from "@workspace/db/schema";
import { count, desc, eq, inArray } from "drizzle-orm";
import {
  access as accessFromDisk,
  mkdir as mkdirOnDisk,
  readFile as readFileFromDisk,
  stat as statFromDisk,
  writeFile as writeFileOnDisk,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute as isAbsolutePath,
  join as joinPath,
  resolve as resolvePath,
} from "node:path";
import { fileURLToPath } from "node:url";
import { fileWatcher } from "../lib/fileWatcher";
import { computeHealthScore } from "../lib/healthScorer";
import { cleanupNonSourceKnowledgeAndRecountBugs } from "../lib/knowledgeCleanup";
import {
  applyVerdictToPersonalKb,
  reinforceSharedKnowledgeFromVerdict,
} from "../lib/learningReinforcement";
import { recordReinforcementEvent } from "../lib/reinforcementTelemetry";
import { ollamaClient } from "../lib/ollamaClient";
import { orchestrator } from "../lib/orchestrator";
import { resolveGithubTokenFromEnvOrDb } from "../lib/githubTokenStore";
import { getKbSessionStats, resetKbSessionStats } from "../lib/sessionStats";
import { invalidateKnowledgeSearchCache } from "../lib/vectorSearch";
import { wsServer } from "../lib/wsServer";
import type { Building, CityLayout } from "../lib/types";

const router: IRouter = Router();

const ORCHESTRATOR_MODEL_KEYS = ["groq_model", "mayor_name"] as const;
const MAYOR_TASK_EVENT_TYPES = new Set(["bug_found", "test_passed", "escalation"]);
const MAYOR_SOURCE_FILE_EXTENSIONS = new Set([".ts", ".js", ".py", ".go", ".rs"]);
const MAYOR_EXCLUDED_DOC_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".mdx"]);
const MAYOR_FILE_QUERY_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]);
const REPORT_SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"]);
const URGENCY_SOURCE_EXTENSIONS = new Set([".ts", ".js", ".py", ".go", ".rs"]);
// Add .html and .htm to exclusion list
const URGENCY_DOC_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json", ".html", ".htm"]);
const URGENCY_DOC_NAME_MARKERS = [
  "handoff",
  "contributing",
  "readme",
  "demo",
  "migration",
  "progress",
  "complete",
];
const MAYOR_MAX_SESSION_MESSAGES = 10;
const MAYOR_MAX_TRACKED_SESSIONS = 200;
const MAX_REVIEW_FINDINGS = 12;
const MAYOR_REVIEW_CONTEXT_KEYS = ["mayor_recent_reviews", "mayor_last_review_date", "mayor_last_review_summary"] as const;
const MAYOR_MEMORY_SETTINGS_KEY = "mayor_memory";
const MAYOR_MEMORY_MAX_SUMMARIES = 20;
const MAYOR_MEMORY_PROMPT_LIMIT = 3;
const MAYOR_MIN_USER_MESSAGES_FOR_SUMMARY = 5;
const MAYOR_INSIGHT_INTERVAL_MS = 10 * 60 * 1000;
const MAYOR_CASUAL_MAX_WORDS = 5;
const MAYOR_INSIGHT_MAX_HISTORY = 24;
const SNIPPET_CACHE_TTL_MS = 60_000;
const TEST_PROPOSAL_TTL_MS = 45 * 60 * 1000;
const MAX_PENDING_TEST_PROPOSALS = 120;
const MAYOR_OLLAMA_MODEL_HINT = (process.env["MAYOR_OLLAMA_MODEL"] ?? "").trim();
const MAYOR_OLLAMA_FALLBACK_MODELS = [
  MAYOR_OLLAMA_MODEL_HINT,
  "qwen2.5:0.5b",
  "qwen2.5:1.5b",
  "tinyllama:1.1b",
  "smollm2:360m",
  "smollm2:135m",
].filter((value): value is string => value.trim().length > 0);

const MAYOR_TECHNICAL_TERMS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  "test",
  "tests",
  "coverage",
  "complexity",
  "bug",
  "bugs",
  "api",
  "database",
  "db",
  "agent",
  "orchestrator",
  "engine",
  "route",
  "endpoint",
  "stack",
  "refactor",
  "deploy",
  "sql",
  "exception",
  "error",
  "trace",
] as const;

const snippetCache = new Map<string, { snippetText: string; cachedAtMs: number }>();
const pendingTestProposals = new Map<string, TestProposal>();

type StoredReportFinding = {
  findingNumber: number;
  filePath: string;
  agentId: string | null;
  agentName: string;
  agentRole: string;
  severityClass: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  issueType: string;
  confidencePercent: number;
  confirmations: number;
  codeReference: string;
  findingText: string;
  codeContext: string;
};

const latestReportFindings: StoredReportFinding[] = [];

type ImportedReviewSummary = {
  importedAt: string;
  verdictsProcessed: number;
  realBugCount: number;
  falsePositiveCount: number;
  agentsUpdated: string[];
  kbEntriesAdded: number;
  commonConfirmedPatterns: string[];
  implementedFixSummary: string;
};

type TestProposal = {
  proposalId: string;
  createdAt: string;
  sourceFilePath: string;
  testFilePath: string;
  testContent: string;
  language: string;
  buildingId: string | null;
  generatedByRole: "scribe";
};

type ParsedReviewVerdictValue = "true_positive" | "false_positive" | "needs_review";

type ParsedVerdict = {
  findingNumber: number | null;
  fileHint: string | null;
  verdict: ParsedReviewVerdictValue;
};

type ParsedAgentAdjustment = {
  agentName: string;
  adjustment: string;
  confidenceRole: string | null;
  confidenceDelta: number;
  avoidPattern: string | null;
};

interface CitySnapshot {
  repoName: string;
  healthScore: number;
  season: string;
  totalBuildings: number;
  untestedBuildings: number;
  fireBuildings: Building[];
  highRiskBuildings: Building[];
  allBuildings: Building[];
}

type MayorEventRow = {
  type: string;
  message: string;
  severity: string;
  timestamp: string;
  buildingId?: string | null;
  buildingName: string | null;
  agentName: string | null;
  agentId: string | null;
  filePath?: string | null;
  issueType?: string | null;
  confidence?: number | null;
  codeReference?: string | null;
  confirmations?: number | null;
  findingSeverity?: string | null;
  findingText?: string | null;
};

type RecentBugSummary = {
  fileName: string;
  detail: string;
  timestamp: string;
};

type RepoContext = {
  snapshot: CitySnapshot;
  repoUrl: string | null;
  branch: string;
  repoSlug: string | null;
};

type TestRecommendation = {
  buildingId: string;
  sourceFilePath: string;
  testFilePath: string;
  whatToTest: string[];
  testType: "unit" | "integration" | "e2e";
  priority: "critical" | "high" | "medium";
};

type MayorConversationEntry = {
  role: "user" | "assistant";
  content: string;
};

type MayorAiResponse = {
  content: string;
  provider: "groq" | "ollama";
  model: string;
  fallbackReason?: string;
};

type MayorMemorySummary = {
  date: string;
  topic: string;
  keyPoints: string[];
  userMood: string;
};

type MayorFileAdviceContext = {
  requestedFile: string;
  normalizedFilePath: string;
  complexity: number | null;
  coveragePercent: number | null;
  linesOfCode: number | null;
  lastAnalyzed: string | null;
  bugCount: number;
  status: string | null;
  agentsVisited: string[];
  taskCompletionAgents: string[];
  taskCompletionCount: number;
  findings: string[];
};

type CasualMayorIntent = "greeting" | "how_are_you" | "what_can_you_do" | "thanks" | "praise";
type MayorHealthBand = "optimistic" | "focused" | "concerned";

const mayorSessionConversations = new Map<string, MayorConversationEntry[]>();
const mayorSessionSummaryFingerprints = new Map<string, string>();
const mayorInsightDeduped = new Set<string>();
const mayorInsightHistory: string[] = [];

let mayorMemorySummaries: MayorMemorySummary[] = [];
let mayorMemoryLoaded = false;
let mayorMemoryLoadPromise: Promise<void> | null = null;
let mayorInsightLoopStarted = false;
let mayorInsightInFlight = false;

function sanitizeMayorMemorySummary(raw: unknown): MayorMemorySummary | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as {
    date?: unknown;
    topic?: unknown;
    keyPoints?: unknown;
    userMood?: unknown;
  };

  const date = typeof record.date === "string" && record.date.trim()
    ? record.date.trim()
    : new Date().toISOString();
  const topic = typeof record.topic === "string" && record.topic.trim()
    ? compactText(record.topic.trim(), 120)
    : "General engineering check-in";
  const keyPoints = Array.isArray(record.keyPoints)
    ? record.keyPoints
      .filter((item): item is string => typeof item === "string")
      .map(item => compactText(item, 140))
      .filter(Boolean)
      .slice(0, 4)
    : [];
  const userMood = typeof record.userMood === "string" && record.userMood.trim()
    ? compactText(record.userMood.trim(), 40)
    : "focused";

  return {
    date,
    topic,
    keyPoints: keyPoints.length > 0 ? keyPoints : ["Reviewed current city engineering priorities."],
    userMood,
  };
}

function parseMayorMemoryValue(raw: string | null | undefined): MayorMemorySummary[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(item => sanitizeMayorMemorySummary(item))
      .filter((item): item is MayorMemorySummary => Boolean(item))
      .slice(-MAYOR_MEMORY_MAX_SUMMARIES);
  } catch {
    return [];
  }
}

async function ensureMayorMemoryLoaded(): Promise<void> {
  if (mayorMemoryLoaded) return;
  if (mayorMemoryLoadPromise) {
    await mayorMemoryLoadPromise;
    return;
  }

  mayorMemoryLoadPromise = (async () => {
    try {
      const row = await db
        .select({ value: settingsTable.value })
        .from(settingsTable)
        .where(eq(settingsTable.key, MAYOR_MEMORY_SETTINGS_KEY))
        .limit(1);

      mayorMemorySummaries = parseMayorMemoryValue(row[0]?.value ?? "[]");
    } catch {
      mayorMemorySummaries = [];
    } finally {
      mayorMemoryLoaded = true;
      mayorMemoryLoadPromise = null;
    }
  })();

  await mayorMemoryLoadPromise;
}

async function persistMayorMemory(): Promise<void> {
  await upsertSettingValue(MAYOR_MEMORY_SETTINGS_KEY, JSON.stringify(mayorMemorySummaries.slice(-MAYOR_MEMORY_MAX_SUMMARIES)));
}

function extractMentionedFileCandidates(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const files: string[] = [];

  for (const raw of matches) {
    const cleaned = raw.replace(/^['"`(]+|[)"'`.,:;!?]+$/g, "").trim();
    if (!cleaned) continue;

    const normalized = normalizePathForLookup(cleaned);
    const ext = extname(normalized.toLowerCase());
    if (!MAYOR_FILE_QUERY_EXTENSIONS.has(ext)) continue;

    const lower = normalized.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    files.push(normalized);
  }

  return files;
}

function inferConversationTopic(history: MayorConversationEntry[]): string {
  const userMessages = history.filter(entry => entry.role === "user").map(entry => entry.content);
  const files = userMessages.flatMap(message => extractMentionedFileCandidates(message));
  if (files.length > 0) {
    return `File guidance: ${basename(files[0])}`;
  }

  const merged = userMessages.join(" ").toLowerCase();
  if (merged.includes("focus") || merged.includes("today")) return "Daily engineering focus";
  if (merged.includes("test")) return "Testing strategy";
  if (merged.includes("bug") || merged.includes("error")) return "Bug triage";
  if (merged.includes("health") || merged.includes("coverage")) return "City health review";
  return "General software architecture coaching";
}

function inferUserMood(history: MayorConversationEntry[]): string {
  const userText = history
    .filter(entry => entry.role === "user")
    .map(entry => entry.content.toLowerCase())
    .join(" ");

  if (/(stuck|blocked|urgent|panic|broken|frustrated|overwhelmed)/.test(userText)) return "concerned";
  if (/(thanks|thank you|great|awesome|love|nice|good job|well done)/.test(userText)) return "positive";
  if (/(why|how|what should|recommend|explain)/.test(userText)) return "curious";
  return "focused";
}

function buildMayorSummaryKeyPoints(history: MayorConversationEntry[]): string[] {
  const userMessages = history.filter(entry => entry.role === "user").map(entry => entry.content);
  const lastAssistant = history.filter(entry => entry.role === "assistant").at(-1)?.content ?? "";
  const keyPoints: string[] = [];

  const files = userMessages.flatMap(message => extractMentionedFileCandidates(message)).slice(0, 2);
  if (files.length > 0) {
    keyPoints.push(`Discussed file risk in ${files.map(file => basename(file)).join(", ")}.`);
  }

  const merged = userMessages.join(" ").toLowerCase();
  if (merged.includes("focus") || merged.includes("today")) {
    keyPoints.push("Set a clear priority order for today's engineering work.");
  }
  if (merged.includes("test")) {
    keyPoints.push("Identified where stronger test coverage will reduce risk fastest.");
  }
  if (merged.includes("bug") || merged.includes("error")) {
    keyPoints.push("Reviewed active bug signals and likely root-cause hotspots.");
  }
  if (lastAssistant) {
    const sentence = lastAssistant.match(/[^.!?]+[.!?]/)?.[0] ?? lastAssistant;
    keyPoints.push(`Last guidance: ${compactText(sentence, 130)}`);
  }

  if (keyPoints.length === 0) {
    keyPoints.push("Held a general architecture and quality check-in.");
  }

  return keyPoints.slice(0, 3);
}

function buildConversationFingerprint(history: MayorConversationEntry[]): string {
  return history
    .slice(-8)
    .map(entry => `${entry.role}:${normalizeReplyForComparison(entry.content)}`)
    .join("|");
}

function isConversationClosingMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return /(thanks|thank you|appreciate it|that's all|thats all|bye|goodbye|see you|talk later)/.test(lower);
}

async function maybePersistMayorConversationSummary(sessionId: string, history: MayorConversationEntry[], latestUserMessage: string): Promise<void> {
  if (!isConversationClosingMessage(latestUserMessage)) return;

  const userMessageCount = history.filter(entry => entry.role === "user").length;
  if (userMessageCount < MAYOR_MIN_USER_MESSAGES_FOR_SUMMARY) return;

  const fingerprint = buildConversationFingerprint(history);
  if (mayorSessionSummaryFingerprints.get(sessionId) === fingerprint) return;

  await ensureMayorMemoryLoaded();

  mayorMemorySummaries = [
    ...mayorMemorySummaries,
    {
      date: new Date().toISOString(),
      topic: inferConversationTopic(history),
      keyPoints: buildMayorSummaryKeyPoints(history),
      userMood: inferUserMood(history),
    },
  ].slice(-MAYOR_MEMORY_MAX_SUMMARIES);

  mayorSessionSummaryFingerprints.set(sessionId, fingerprint);
  await persistMayorMemory();
}

function formatMayorMemoryForPrompt(summaries: MayorMemorySummary[]): string {
  if (summaries.length === 0) return "- none yet";

  return summaries
    .slice(-MAYOR_MEMORY_PROMPT_LIMIT)
    .map(summary => {
      const dateText = summary.date.split("T")[0] ?? summary.date;
      const keyPointsText = summary.keyPoints.join("; ");
      return `- ${dateText}: ${summary.topic}. Mood: ${summary.userMood}. Key points: ${compactText(keyPointsText, 220)}`;
    })
    .join("\n");
}

function containsTechnicalTerms(message: string): boolean {
  const lower = message.toLowerCase();
  if (/[`{}()[\]<>]/.test(message)) return true;
  if (extractMentionedFileCandidates(message).length > 0) return true;
  return MAYOR_TECHNICAL_TERMS.some(term => lower.includes(term));
}

function detectCasualMayorIntent(message: string): CasualMayorIntent | null {
  const lower = message.toLowerCase().trim();

  if (/^(hi|hello|hey|yo)$/.test(lower)) return "greeting";
  if (/(^|\s)(hi|hello|hey)(\s|$)/.test(lower)) return "greeting";
  if (lower.includes("how are you") || lower === "howre you") return "how_are_you";
  if (lower.includes("what can you do") || lower === "capabilities") return "what_can_you_do";
  if (/(^|\s)(thanks|thank you|thx)(\s|$)/.test(lower)) return "thanks";
  if (lower.includes("good job") || lower.includes("well done") || lower === "nice") return "praise";
  return null;
}

function shouldUseCasualMayorTemplate(message: string, intent: CasualMayorIntent | null): intent is CasualMayorIntent {
  if (!intent) return false;
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  return words <= MAYOR_CASUAL_MAX_WORDS && !containsTechnicalTerms(message);
}

function buildMayorCityFact(snapshot: CitySnapshot, activeAgents: number): string {
  if (snapshot.fireBuildings.length > 0) {
    return `${snapshot.fireBuildings.length} building${snapshot.fireBuildings.length === 1 ? " is" : "s are"} still on fire`;
  }
  return `city health is ${Math.round(snapshot.healthScore)}/100 with ${activeAgents} agents on duty`;
}

function buildMayorWatchTarget(snapshot: CitySnapshot, recentBugSummaries: RecentBugSummary[]): string {
  if (recentBugSummaries.length > 0) {
    return basename(recentBugSummaries[0].fileName);
  }

  const highestRiskSource = snapshot.highRiskBuildings.find(isUrgencySourceBuilding);
  if (highestRiskSource) {
    return basename(highestRiskSource.filePath);
  }

  return "high-complexity low-coverage files";
}

function getMayorHealthBand(healthScore: number): MayorHealthBand {
  if (healthScore > 70) return "optimistic";
  if (healthScore >= 40) return "focused";
  return "concerned";
}

function chooseNonRepeatingMayorLine(lines: string[], history: MayorConversationEntry[]): string {
  const priorAssistantLines = new Set(
    history
      .filter(entry => entry.role === "assistant")
      .map(entry => normalizeReplyForComparison(entry.content))
  );

  const unseen = lines.find(line => !priorAssistantLines.has(normalizeReplyForComparison(line)));
  if (unseen) return unseen;

  const assistantReplyCount = history.filter(entry => entry.role === "assistant").length;
  return lines[assistantReplyCount % lines.length] ?? lines[0] ?? "Hello.";
}

function buildCasualMayorReply(params: {
  intent: CasualMayorIntent;
  mayorName: string;
  snapshot: CitySnapshot;
  activeAgents: number;
  recentBugSummaries: RecentBugSummary[];
  conversationHistory: MayorConversationEntry[];
}): string {
  const cityFact = buildMayorCityFact(params.snapshot, params.activeAgents);
  const watchTarget = buildMayorWatchTarget(params.snapshot, params.recentBugSummaries);
  const healthBand = getMayorHealthBand(params.snapshot.healthScore);

  if (params.intent === "greeting") {
    const greetingByBand: Record<MayorHealthBand, string[]> = {
      optimistic: [
        `Hello, I am ${params.mayorName}, and the city is in a strong rhythm today.`,
        `Hi, ${params.mayorName} here; we are in a healthy window, so this is a good time to harden weak seams.`,
        `Good to see you, I am ${params.mayorName}, and we have enough stability to improve quality with intention.`,
      ],
      focused: [
        `Hello, I am ${params.mayorName}; we are stable enough to move, but we need disciplined execution.`,
        `Hi, ${params.mayorName} here; conditions are mixed, so I am prioritizing practical risk reduction.`,
        `Good to connect, I am ${params.mayorName}, and my focus is steady progress on the highest-risk blocks.`,
      ],
      concerned: [
        `Hello, I am ${params.mayorName}; we are under pressure, and I am staying calm and deliberate.`,
        `Hi, ${params.mayorName} here; the city needs careful triage, so we will solve the sharpest problems first.`,
        `Good to see you, I am ${params.mayorName}, and I am focused on controlled recovery over rushed changes.`,
      ],
    };

    const followUpByBand: Record<MayorHealthBand, string> = {
      optimistic: `${cityFact}, and I want to keep momentum by hardening ${watchTarget} before it surprises us.`,
      focused: `${cityFact}, and I want tight execution around ${watchTarget} to prevent avoidable regressions.`,
      concerned: `${cityFact}, and I want calm, targeted fixes around ${watchTarget} before we widen scope.`,
    };

    const intro = chooseNonRepeatingMayorLine(greetingByBand[healthBand], params.conversationHistory);
    return `${intro} ${followUpByBand[healthBand]}`;
  }

  if (params.intent === "how_are_you") {
    if (healthBand === "optimistic") {
      return `I am doing well and fully in the loop. ${cityFact}, so I am pushing preventive cleanup while conditions are favorable.`;
    }
    if (healthBand === "focused") {
      return `I am focused and practical right now. ${cityFact}, and I am keeping attention on ${watchTarget} so the city stays predictable.`;
    }
    return `I am calm and alert. ${cityFact}, and my priority is reducing risk in ${watchTarget} with clean, reversible changes.`;
  }

  if (params.intent === "what_can_you_do") {
    return `I can help you choose what to fix first, explain why a file is risky, and turn noisy telemetry into concrete next steps. If you name a file, I will speak specifically about its complexity, coverage, and what agents already found there. I also keep memory of our prior conversations so I can coach with context instead of repeating myself.`;
  }

  if (params.intent === "thanks") {
    return `You are welcome. I will keep watching ${watchTarget} and the active fire queue so we catch trouble before it catches us.`;
  }

  return `Thank you, I appreciate it. I am proud of the progress, but I still want tighter tests and cleaner boundaries around ${watchTarget}.`;
}

function normalizeMayorSessionId(raw: unknown): string {
  if (typeof raw !== "string") return "default";
  const trimmed = raw.trim();
  if (!trimmed) return "default";
  return trimmed.slice(0, 128);
}

function getMayorConversation(sessionId: string): MayorConversationEntry[] {
  return mayorSessionConversations.get(sessionId) ?? [];
}

function appendMayorConversation(sessionId: string, role: "user" | "assistant", content: string): void {
  const current = getMayorConversation(sessionId);
  const next = [...current, { role, content }].slice(-MAYOR_MAX_SESSION_MESSAGES);
  mayorSessionConversations.set(sessionId, next);

  if (mayorSessionConversations.size > MAYOR_MAX_TRACKED_SESSIONS) {
    const oldestKey = mayorSessionConversations.keys().next().value;
    if (oldestKey) mayorSessionConversations.delete(oldestKey);
  }
}

function formatConversationHistoryForPrompt(mayorName: string, history: MayorConversationEntry[]): string {
  if (history.length === 0) return "none yet";

  return history
    .map(entry => `${entry.role === "assistant" ? mayorName : "User"}: ${compactText(entry.content, 240)}`)
    .join("\n");
}

function normalizeReplyForComparison(reply: string): string {
  return reply.toLowerCase().replace(/\s+/g, " ").trim();
}

function avoidRepeatedMayorReply(params: {
  history: MayorConversationEntry[];
  reply: string;
  userMessage: string;
  computedStatus: string;
}): string {
  const normalizedHistory = new Set(
    params.history
      .filter(item => item.role === "assistant")
      .map(item => normalizeReplyForComparison(item.content))
  );

  const normalizedReply = normalizeReplyForComparison(params.reply);
  if (!normalizedHistory.has(normalizedReply)) return params.reply;

  const followUpIndex = params.history.filter(item => item.role === "assistant").length + 1;
  return [
    `I already covered that, so here is a sharper next step for "${compactText(params.userMessage, 56)}" (follow-up ${followUpIndex}).`,
    `${params.computedStatus}`,
    "I recommend running targeted tests on the highest-complexity untested source files and then rechecking the urgency report.",
  ].join(" ");
}

function normalizeGroqModel(model: string): string {
  if (model === "llama-3.1-70b-versatile") return "llama-3.3-70b-versatile";
  return model;
}

function toCitySnapshot(layout: CityLayout | null, repoName: string): CitySnapshot {
  const allBuildings = layout?.districts.flatMap(d => d.buildings) ?? [];
  const fireBuildings = allBuildings.filter(b => b.status === "fire" || b.status === "error");
  const highRiskBuildings = allBuildings.filter(
    b => b.complexity >= 15 || (!b.hasTests && b.linesOfCode >= 80) || b.testCoverage < 0.2,
  );
  const untestedBuildings = allBuildings.filter(b => !b.hasTests || b.testCoverage < 0.1).length;

  return {
    repoName,
    healthScore: layout?.healthScore ?? 0,
    season: layout?.season ?? "unknown",
    totalBuildings: allBuildings.length,
    untestedBuildings,
    fireBuildings,
    highRiskBuildings,
    allBuildings,
  };
}

function parseLayout(layoutData: string | null): CityLayout | null {
  if (!layoutData) return null;
  try {
    return JSON.parse(layoutData) as CityLayout;
  } catch {
    return null;
  }
}

async function getLatestSnapshot(): Promise<CitySnapshot> {
  const context = await getLatestRepoContext();
  return context.snapshot;
}

async function getLatestRepoContext(): Promise<RepoContext> {
  const active = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
  const source = active.length > 0
    ? active[0]
    : (await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1))[0];

  if (!source) {
    return {
      snapshot: toCitySnapshot(null, "No repository loaded"),
      repoUrl: null,
      branch: "main",
      repoSlug: null,
    };
  }

  const layout = parseLayout(source.layoutData);
  return {
    snapshot: toCitySnapshot(layout, source.repoName),
    repoUrl: source.repoUrl,
    branch: source.branch ?? "main",
    repoSlug: source.slug ?? null,
  };
}

function parseGithubRepoParts(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
  };
}

async function githubHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = await resolveGithubTokenFromEnvOrDb();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function fetchGithubFileContent(repoUrl: string | null, branch: string, filePath: string): Promise<string | null> {
  if (!repoUrl) return null;
  const parsed = parseGithubRepoParts(repoUrl);
  if (!parsed) return null;

  const encodedPath = filePath.split("/").map(part => encodeURIComponent(part)).join("/");
  const contentUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

  try {
    const res = await fetch(contentUrl, { headers: await githubHeaders() });
    if (!res.ok) return null;
    const data = await res.json() as { content?: string; encoding?: string };
    if (!data.content) return null;

    if ((data.encoding ?? "base64") === "base64") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }

    return data.content;
  } catch {
    return null;
  }
}

function normalizePathForLookup(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function tokenizeSnippetHint(text: string): string[] {
  const stopWords = new Set([
    "the", "and", "with", "that", "from", "this", "have", "into", "were", "been", "there", "what", "when",
    "where", "which", "about", "after", "before", "agent", "issue", "found", "file", "line", "error", "warning",
  ]);

  const raw = text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  return Array.from(new Set(raw.map(token => token.toLowerCase()).filter(token => !stopWords.has(token)))).slice(0, 12);
}

function findSnippetAnchorLine(contentLines: string[], filePath: string, hintText: string): number {
  const lowerLines = contentLines.map(line => line.toLowerCase());
  const hintTokens = tokenizeSnippetHint(hintText);

  for (const token of hintTokens) {
    const idx = lowerLines.findIndex(line => line.includes(token));
    if (idx >= 0) return idx;
  }

  const fileStem = basename(filePath, extname(filePath)).toLowerCase();
  if (fileStem) {
    const byStem = lowerLines.findIndex(line => line.includes(fileStem));
    if (byStem >= 0) return byStem;
  }

  return -1;
}

function formatSnippetWithLineNumbers(content: string, filePath: string, hintText: string): string {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return "Code snippet unavailable";

  const anchor = findSnippetAnchorLine(lines, filePath, hintText);
  const hasAnchor = anchor >= 0;
  const windowSize = hasAnchor
    ? Math.min(20, lines.length)
    : Math.min(30, lines.length);

  let start = 0;
  if (hasAnchor) {
    start = Math.max(0, anchor - Math.floor(windowSize / 2));
  }

  if (start + windowSize > lines.length) {
    start = Math.max(0, lines.length - windowSize);
  }
  const end = Math.min(lines.length, start + windowSize);

  return lines
    .slice(start, end)
    .map((line, idx) => `L${start + idx + 1}: ${line}`)
    .join("\n");
}

function getCachedSnippet(cacheKey: string): string | null {
  const entry = snippetCache.get(cacheKey);
  if (!entry) return null;

  if ((Date.now() - entry.cachedAtMs) > SNIPPET_CACHE_TTL_MS) {
    snippetCache.delete(cacheKey);
    return null;
  }

  return entry.snippetText;
}

function setCachedSnippet(cacheKey: string, snippetText: string): void {
  snippetCache.set(cacheKey, {
    snippetText,
    cachedAtMs: Date.now(),
  });
}

function toLocalPath(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^file:\/\//i.test(trimmed)) {
    try {
      return resolvePath(fileURLToPath(trimmed));
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("demo://")) {
    return null;
  }

  if (trimmed.startsWith("~/")) {
    const home = process.env["HOME"];
    if (!home) return null;
    return resolvePath(joinPath(home, trimmed.slice(2)));
  }

  if (isAbsolutePath(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return resolvePath(trimmed);
  }

  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return resolvePath(process.cwd(), trimmed);
  }

  return null;
}

async function getLastLoadedLocalRepoPath(): Promise<string | null> {
  const candidates: string[] = [];

  const active = await db
    .select({ repoUrl: reposTable.repoUrl })
    .from(reposTable)
    .where(eq(reposTable.isActive, true))
    .limit(1);

  for (const row of active) {
    if (row.repoUrl) candidates.push(row.repoUrl);
  }

  const recent = await db
    .select({ repoUrl: reposTable.repoUrl })
    .from(reposTable)
    .orderBy(desc(reposTable.createdAt))
    .limit(5);

  for (const row of recent) {
    if (row.repoUrl) candidates.push(row.repoUrl);
  }

  for (const candidate of candidates) {
    const localPath = toLocalPath(candidate);
    if (localPath) return localPath;
  }

  return null;
}

async function resolveLocalRepoRoots(): Promise<string[]> {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null): void => {
    const resolved = toLocalPath(value) ?? (value ? resolvePath(value) : null);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    ordered.push(resolved);
  };

  add(fileWatcher.getWatchedPath().trim() || null);
  add(process.cwd());
  add(await getLastLoadedLocalRepoPath());

  return ordered;
}

function resolveFilePathInRepo(repoRoot: string, filePath: string): string | null {
  const normalizedPath = normalizePathForLookup(filePath);
  if (!normalizedPath) return null;

  const absoluteTarget = isAbsolutePath(normalizedPath)
    ? resolvePath(normalizedPath)
    : resolvePath(joinPath(repoRoot, normalizedPath));

  // Keep relative lookups inside the intended repo root.
  if (!isAbsolutePath(normalizedPath) && !absoluteTarget.startsWith(repoRoot)) {
    return null;
  }

  return absoluteTarget;
}

async function getRepoContextBySlug(repoSlug: string | null): Promise<{ repoUrl: string | null; branch: string } | null> {
  if (repoSlug) {
    const bySlug = await db.select().from(reposTable).where(eq(reposTable.slug, repoSlug)).limit(1);
    if (bySlug.length > 0) {
      return {
        repoUrl: bySlug[0].repoUrl,
        branch: bySlug[0].branch ?? "main",
      };
    }
  }

  const activeRepo = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
  if (activeRepo.length > 0) {
    return {
      repoUrl: activeRepo[0].repoUrl,
      branch: activeRepo[0].branch ?? "main",
    };
  }

  const latestRepo = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
  if (latestRepo.length === 0) return null;
  return {
    repoUrl: latestRepo[0].repoUrl,
    branch: latestRepo[0].branch ?? "main",
  };
}

async function readLocalFileFirst(filePath: string): Promise<string | null> {
  const roots = await resolveLocalRepoRoots();

  for (const root of roots) {
    const target = resolveFilePathInRepo(root, filePath);
    if (!target) continue;

    try {
      const stats = await statFromDisk(target);
      if (!stats.isFile()) continue;
      return await readFileFromDisk(target, "utf8");
    } catch {
      continue;
    }
  }

  return null;
}

function createTestProposalId(): string {
  return `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pruneExpiredTestProposals(): void {
  const now = Date.now();
  for (const [proposalId, proposal] of pendingTestProposals.entries()) {
    const createdAt = Date.parse(proposal.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt > TEST_PROPOSAL_TTL_MS) {
      pendingTestProposals.delete(proposalId);
    }
  }
}

function rememberTestProposal(input: Omit<TestProposal, "proposalId" | "createdAt">): TestProposal {
  pruneExpiredTestProposals();

  const proposal: TestProposal = {
    ...input,
    proposalId: createTestProposalId(),
    createdAt: new Date().toISOString(),
  };

  pendingTestProposals.set(proposal.proposalId, proposal);

  if (pendingTestProposals.size > MAX_PENDING_TEST_PROPOSALS) {
    const oldest = pendingTestProposals.keys().next().value;
    if (oldest) pendingTestProposals.delete(oldest);
  }

  return proposal;
}

function getPendingTestProposal(proposalId: string): TestProposal | null {
  pruneExpiredTestProposals();
  return pendingTestProposals.get(proposalId) ?? null;
}

function normalizeRelativeWritePath(filePath: string): string | null {
  const normalized = normalizePathForLookup(filePath);
  if (!normalized) return null;
  if (isAbsolutePath(normalized) || /^[A-Za-z]:[\\/]/.test(normalized)) return null;
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return null;
  return normalized;
}

async function pathExistsOnDisk(pathValue: string): Promise<boolean> {
  try {
    await accessFromDisk(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function resolveWritableRepoRoot(sourceFilePath: string): Promise<string | null> {
  const roots = await resolveLocalRepoRoots();
  const normalizedSource = normalizeRelativeWritePath(sourceFilePath);

  for (const root of roots) {
    try {
      const stats = await statFromDisk(root);
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }

    if (normalizedSource) {
      const sourceAbsolute = resolveFilePathInRepo(root, normalizedSource);
      if (sourceAbsolute && await pathExistsOnDisk(sourceAbsolute)) {
        return root;
      }
    }
  }

  for (const root of roots) {
    try {
      const stats = await statFromDisk(root);
      if (stats.isDirectory()) return root;
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchGithubRawFileContent(repoUrl: string | null, branch: string, filePath: string): Promise<string | null> {
  if (!repoUrl) return null;
  const parsed = parseGithubRepoParts(repoUrl);
  if (!parsed) return null;

  const encodedPath = filePath.split("/").map(part => encodeURIComponent(part)).join("/");
  const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(branch)}/${encodedPath}`;

  const token = await resolveGithubTokenFromEnvOrDb();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(rawUrl, { headers });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Required helper for report generation.
async function fetchFileSnippet(filePath: string, repoSlug: string | null, hintText = ""): Promise<string> {
  const normalizedPath = normalizePathForLookup(filePath);
  if (!normalizedPath) return "Code snippet unavailable";

  const cached = getCachedSnippet(normalizedPath);
  if (cached) return cached;

  // Always try local disk first to avoid GitHub API rate-limit failures.
  const localContent = await readLocalFileFirst(normalizedPath);
  if (localContent) {
    const snippet = formatSnippetWithLineNumbers(localContent, normalizedPath, hintText);
    setCachedSnippet(normalizedPath, snippet);
    return snippet;
  }

  const repoContext = await getRepoContextBySlug(repoSlug);
  if (!repoContext || !repoContext.repoUrl || (repoContext.repoUrl ?? "").startsWith("demo://")) {
    return "Code snippet unavailable";
  }

  const remoteContent = await fetchGithubRawFileContent(repoContext.repoUrl, repoContext.branch, normalizedPath);
  if (!remoteContent) return "Code snippet unavailable";

  const snippet = formatSnippetWithLineNumbers(remoteContent, normalizedPath, hintText);
  setCachedSnippet(normalizedPath, snippet);
  return snippet;
}

function resolveFindingFilePath(event: MayorEventRow, snapshot: CitySnapshot): string | null {
  if (event.filePath && event.filePath.trim()) {
    return normalizePathForLookup(event.filePath);
  }

  if (event.buildingId) {
    const byId = snapshot.allBuildings.find(building => building.id === event.buildingId);
    if (byId?.filePath) return normalizePathForLookup(byId.filePath);
  }

  const byName = event.buildingName
    ? snapshot.allBuildings.find(building => (
      building.name.toLowerCase() === event.buildingName?.toLowerCase()
      || normalizePathForLookup(building.filePath).toLowerCase() === normalizePathForLookup(event.buildingName ?? "").toLowerCase()
    ))
    : null;
  if (byName?.filePath) return normalizePathForLookup(byName.filePath);

  const fromEventText = extractEventFilePath(event);
  if (fromEventText) return normalizePathForLookup(fromEventText);

  return null;
}

function inferIssueTypeFromFinding(event: MayorEventRow): string {
  if (event.issueType && event.issueType.trim()) return event.issueType;

  const message = event.message.toLowerCase();

  if (event.type === "escalation") return "Escalation Required";
  if (message.includes("null") || message.includes("undefined")) return "Null Safety";
  if (message.includes("race") || message.includes("concurrent") || message.includes("deadlock")) return "Concurrency Risk";
  if (message.includes("timeout") || message.includes("latency") || message.includes("slow")) return "Performance Risk";
  if (message.includes("auth") || message.includes("permission") || message.includes("token")) return "Authorization Risk";
  if (message.includes("sql") || message.includes("injection") || message.includes("xss")) return "Security Risk";
  if (event.type === "bug_found") return "Potential Bug";
  return "Code Risk Signal";
}

function normalizeFindingSeverity(raw: string | null | undefined): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "CRITICAL" || upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") return upper;
  return null;
}

function severityFromLegacyEvent(raw: string | null | undefined): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  const lower = (raw ?? "").trim().toLowerCase();
  if (lower === "critical") return "CRITICAL";
  if (lower === "warning") return "HIGH";
  return "LOW";
}

function resolveSeverityClass(event: MayorEventRow): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  return normalizeFindingSeverity(event.findingSeverity) ?? severityFromLegacyEvent(event.severity);
}

function toConfidencePercent(confidence: number | null | undefined, accuracy: number | undefined, severityClass: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"): number {
  const base = Number.isFinite(confidence ?? NaN)
    ? Math.round(Math.max(0, Math.min(1, confidence ?? 0)) * 100)
    : Math.round((accuracy ?? 0.65) * 100);
  const severityBoost = severityClass === "CRITICAL" ? 4 : severityClass === "HIGH" ? 2 : 0;
  return Math.max(5, Math.min(99, base + severityBoost));
}

function isReviewFindingEvent(event: MayorEventRow): boolean {
  if (event.type !== "bug_found") return false;
  if (!normalizeFindingSeverity(event.findingSeverity)) return false;
  return Boolean(event.filePath || event.buildingId || event.buildingName);
}

async function buildAiReviewFindings(params: {
  snapshot: CitySnapshot;
  repoSlug: string | null;
  agents: Array<typeof agentsTable.$inferSelect>;
  events: MayorEventRow[];
}): Promise<StoredReportFinding[]> {
  const agentsById = new Map(params.agents.map(agent => [agent.id, agent]));
  const agentsByName = new Map(params.agents.map(agent => [agent.name.toLowerCase(), agent]));
  const snapshotFilePaths = new Set(
    params.snapshot.allBuildings.map(building => normalizePathForLookup(building.filePath).toLowerCase())
  );
  const findings: StoredReportFinding[] = [];
  const seen = new Set<string>();

  for (const event of params.events) {
    if (!isReviewFindingEvent(event)) continue;

    const severityClass = resolveSeverityClass(event);

    const filePath = resolveFindingFilePath(event, params.snapshot);
    if (!filePath) continue;
    if (!snapshotFilePaths.has(filePath.toLowerCase())) continue;

    const ext = extname(filePath.toLowerCase());
    if (!REPORT_SOURCE_FILE_EXTENSIONS.has(ext)) continue;

    const issueType = inferIssueTypeFromFinding(event);
    const dedupeKey = `${filePath}|${issueType}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const linkedAgent = event.agentId
      ? agentsById.get(event.agentId)
      : event.agentName
        ? agentsByName.get(event.agentName.toLowerCase())
        : undefined;

    const agentName = linkedAgent?.name ?? event.agentName ?? "Unknown Agent";
    const agentRole = linkedAgent?.role ?? "unassigned";
    const confidencePercent = toConfidencePercent(event.confidence, linkedAgent?.accuracy, severityClass);
    const confirmations = Math.max(1, event.confirmations ?? 1);
    const findingText = compactText(event.findingText ?? event.message, 360);
    const codeReference = compactText(event.codeReference ?? "specific pattern referenced", 140);
    const codeContext = await fetchFileSnippet(filePath, params.repoSlug, `${findingText} ${issueType}`);

    findings.push({
      findingNumber: findings.length + 1,
      filePath,
      agentId: linkedAgent?.id ?? event.agentId ?? null,
      agentName,
      agentRole,
      severityClass,
      issueType,
      confidencePercent,
      confirmations,
      codeReference,
      findingText,
      codeContext,
    });

    if (findings.length >= MAX_REVIEW_FINDINGS) break;
  }

  return findings;
}

function formatAgentLearningLine(agent: typeof agentsTable.$inferSelect): string {
  const totalReviewed = agent.truePositives + agent.falsePositives;
  const confirmedRate = totalReviewed > 0
    ? Math.round((agent.truePositives / totalReviewed) * 100)
    : Math.round(agent.accuracy * 100);

  return `- ${agent.name} (${agent.role}) - confidence ${Math.round(agent.accuracy * 100)}%, accuracy history: TP ${agent.truePositives}, FP ${agent.falsePositives}, confirmed rate ${confirmedRate}%`;
}

function normalizeReviewSectionTitle(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toUpperCase();
}

function isReviewSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  return /^[A-Z][A-Z0-9 _-]{3,}:?$/.test(trimmed);
}

function parseReviewSections(reviewText: string): Array<{ title: string; body: string }> {
  const lines = reviewText.split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];

  let currentTitle = "FULL TEXT";
  let currentBody: string[] = [];

  for (const line of lines) {
    if (isReviewSectionHeader(line)) {
      sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
      currentTitle = normalizeReviewSectionTitle(line.trim());
      currentBody = [];
      continue;
    }
    currentBody.push(line);
  }

  sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
  return sections;
}

function findSectionBody(sections: Array<{ title: string; body: string }>, keywords: string[]): string {
  const normalized = keywords.map(keyword => keyword.toUpperCase());
  const direct = sections.find(section => normalized.every(keyword => section.title.includes(keyword)));
  if (direct) return direct.body;

  const partial = sections.find(section => normalized.some(keyword => section.title.includes(keyword)));
  return partial?.body ?? "";
}

function parseVerdictKeyword(line: string): ParsedReviewVerdictValue | null {
  const upper = line.toUpperCase();
  if (/\bINVESTIGATE\b/.test(upper)) return "needs_review";
  if (/\bFALSE\s*POSITIVE\b|\bFALSE[-_ ]POSITIVE\b|\bFALSE\b/.test(upper)) return "false_positive";
  if (/\bREAL\b|\bCRITICAL\b|\bTRUE\b/.test(upper)) return "true_positive";
  return null;
}

function extractVerdictFileHint(line: string): string | null {
  const delimiterMatch = line.match(/(?:->|=>|→|:)/);
  const beforeDelimiter = delimiterMatch?.index !== undefined
    ? line.slice(0, delimiterMatch.index)
    : line;

  const cleaned = beforeDelimiter
    .replace(/^(?:[-*]\s*|\d+[.)]\s*)/, "")
    .trim();

  const extensionMatch = cleaned.match(/([A-Za-z0-9_./\\-]+\.(?:ts|js|py|go))(?![A-Za-z0-9])/i)
    ?? line.match(/([A-Za-z0-9_./\\-]+\.(?:ts|js|py|go))(?![A-Za-z0-9])/i);

  if (extensionMatch?.[1]) {
    return normalizePathForLookup(extensionMatch[1]);
  }

  const pathOnlyMatch = cleaned.match(/([A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+)/);
  if (pathOnlyMatch?.[1]) {
    return normalizePathForLookup(pathOnlyMatch[1]);
  }

  return null;
}

function parseVerdictsFromText(text: string): ParsedVerdict[] {
  const verdicts = new Map<string, ParsedVerdict>();

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const verdict = parseVerdictKeyword(trimmed);
    if (!verdict) continue;

    const findingMatch = trimmed.match(/FINDING\s*#?\s*(\d+)/i);
    const parsedFindingNumber = findingMatch ? Number(findingMatch[1]) : NaN;
    const findingNumber = Number.isFinite(parsedFindingNumber) && parsedFindingNumber > 0
      ? parsedFindingNumber
      : null;

    const fileHint = extractVerdictFileHint(trimmed);
    if (!findingNumber && !fileHint) continue;

    const key = findingNumber
      ? `finding:${findingNumber}`
      : `file:${(fileHint ?? "").toLowerCase()}`;

    verdicts.set(key, {
      findingNumber,
      fileHint,
      verdict,
    });
  }

  return Array.from(verdicts.values()).sort((a, b) => {
    const left = a.findingNumber ?? Number.MAX_SAFE_INTEGER;
    const right = b.findingNumber ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;

    const leftPath = (a.fileHint ?? "").toLowerCase();
    const rightPath = (b.fileHint ?? "").toLowerCase();
    return leftPath.localeCompare(rightPath);
  });
}

function parseAgentAdjustments(sectionText: string): ParsedAgentAdjustment[] {
  if (!sectionText.trim()) return [];

  const adjustments: ParsedAgentAdjustment[] = [];
  const lines = sectionText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cleaned = trimmed.replace(/^(?:[-*]\s*|\d+[.)]\s*)/, "").trim();
    if (!cleaned) continue;

    const namedPrefix = cleaned.match(/^([A-Za-z][A-Za-z0-9 _-]{1,48})\s*[:\-]\s*(.+)$/);
    const instruction = (namedPrefix?.[2] ?? cleaned).trim();

    const increaseMatch = instruction.match(/\bincrease\s+([A-Za-z][A-Za-z0-9 _-]{1,48})\s+confidence\b/i);
    const decreaseMatch = instruction.match(/\bdecrease\s+([A-Za-z][A-Za-z0-9 _-]{1,48})\s+confidence\b/i);
    const neverMatch = instruction.match(/\bshould\s+NEVER\s+(.+)$/i);

    const confidenceRole = increaseMatch?.[1]?.trim() ?? decreaseMatch?.[1]?.trim() ?? null;
    const confidenceDelta = increaseMatch ? 1 : decreaseMatch ? -1 : 0;
    const avoidPattern = neverMatch?.[1] ? compactText(neverMatch[1].trim(), 180) : null;

    const legacyMatch = cleaned.match(/(?:[-*]\s*)?([A-Za-z][A-Za-z0-9 _-]{1,48})\s*[:\-]\s*(.+)$/);
    if (!legacyMatch && confidenceDelta === 0 && !avoidPattern) continue;

    const agentName = namedPrefix?.[1]?.trim() ?? confidenceRole ?? legacyMatch?.[1]?.trim() ?? "General";
    const adjustmentText = namedPrefix?.[2] ?? legacyMatch?.[2] ?? instruction;

    adjustments.push({
      agentName,
      adjustment: compactText(adjustmentText, 180),
      confidenceRole,
      confidenceDelta,
      avoidPattern,
    });
  }

  return adjustments;
}

function normalizeRoleForMatching(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function roleMatches(agentRole: string, targetRole: string): boolean {
  const normalizedAgent = normalizeRoleForMatching(agentRole);
  const normalizedTarget = normalizeRoleForMatching(targetRole);
  if (!normalizedAgent || !normalizedTarget) return false;
  return normalizedAgent === normalizedTarget || normalizedAgent.includes(normalizedTarget) || normalizedTarget.includes(normalizedAgent);
}

function summarizeImplementedFixes(sectionText: string): string {
  if (!sectionText.trim()) return "No implemented fixes provided in the imported review.";
  const lines = sectionText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (lines.length === 0) return "No implemented fixes provided in the imported review.";
  return compactText(lines.join(" | "), 420);
}

function normalizeIssuePattern(issueType: string): string {
  return issueType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "general";
}

async function upsertSettingValue(key: string, value: string): Promise<void> {
  await db.insert(settingsTable)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date().toISOString() },
    });
}

async function readMayorReviewContext(): Promise<{
  recentReviews: ImportedReviewSummary[];
  lastReviewDate: string | null;
  lastReviewSummary: string | null;
}> {
  try {
    const rows = await db
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(inArray(settingsTable.key, [...MAYOR_REVIEW_CONTEXT_KEYS]));

    const valueByKey = new Map(rows.map(row => [row.key, row.value]));
    const recentRaw = valueByKey.get("mayor_recent_reviews") ?? "[]";
    const parsedRecent = JSON.parse(recentRaw) as ImportedReviewSummary[];

    return {
      recentReviews: Array.isArray(parsedRecent) ? parsedRecent.slice(-3) : [],
      lastReviewDate: valueByKey.get("mayor_last_review_date") ?? null,
      lastReviewSummary: valueByKey.get("mayor_last_review_summary") ?? null,
    };
  } catch {
    return {
      recentReviews: [],
      lastReviewDate: null,
      lastReviewSummary: null,
    };
  }
}

async function writeMayorReviewContext(summary: ImportedReviewSummary): Promise<void> {
  const existing = await readMayorReviewContext();
  const recentReviews = [...existing.recentReviews, summary].slice(-3);

  await Promise.all([
    upsertSettingValue("mayor_recent_reviews", JSON.stringify(recentReviews)),
    upsertSettingValue("mayor_last_review_date", summary.importedAt),
    upsertSettingValue("mayor_last_review_summary", summary.implementedFixSummary),
  ]);
}

function formatRecentReviewsForPrompt(recentReviews: ImportedReviewSummary[]): string {
  if (recentReviews.length === 0) return "none";
  return recentReviews
    .slice(-3)
    .map(review => `(${review.importedAt}) verdicts=${review.verdictsProcessed}, real=${review.realBugCount}, false_positive=${review.falsePositiveCount}, agents=${review.agentsUpdated.join(", ") || "none"}, patterns=${review.commonConfirmedPatterns.join(", ") || "none"}`)
    .join(" | ");
}

function findMostAccurateAgent(agents: Array<typeof agentsTable.$inferSelect>): { name: string; role: string; accuracyPercent: number } | null {
  if (agents.length === 0) return null;

  const candidates = agents
    .map(agent => {
      const reviewed = agent.truePositives + agent.falsePositives;
      const confirmedRate = reviewed > 0 ? (agent.truePositives / reviewed) : agent.accuracy;
      return { agent, confirmedRate, reviewed };
    })
    .sort((a, b) => {
      if (b.confirmedRate !== a.confirmedRate) return b.confirmedRate - a.confirmedRate;
      if (b.reviewed !== a.reviewed) return b.reviewed - a.reviewed;
      return b.agent.truePositives - a.agent.truePositives;
    });

  const best = candidates[0];
  return {
    name: best.agent.name,
    role: best.agent.role,
    accuracyPercent: Math.round(best.confirmedRate * 1000) / 10,
  };
}

function parseConfirmedPattern(problemType: string, patternTags: string | null): string | null {
  if (problemType.startsWith("confirmed_bug_")) {
    return problemType
      .replace("confirmed_bug_", "")
      .replace(/_/g, " ")
      .trim();
  }

  const tags = (patternTags ?? "").split(",").map(tag => tag.trim()).filter(Boolean);
  if (!tags.includes("confirmed")) return null;

  const specificTag = tags.find(tag => !["confirmed", "review-import"].includes(tag));
  return specificTag ?? "general pattern";
}

function topConfirmedPatterns(entries: Array<{ problemType: string; patternTags: string | null }>): string[] {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const pattern = parseConfirmedPattern(entry.problemType, entry.patternTags);
    if (!pattern) continue;
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, countValue]) => `${pattern} (${countValue})`);
}

function buildReviewAwareMayorReply(params: {
  message: string;
  recentReviews: ImportedReviewSummary[];
  lastReviewDate: string | null;
  lastReviewSummary: string | null;
  agents: Array<typeof agentsTable.$inferSelect>;
  confirmedPatterns: string[];
}): string | null {
  const q = params.message.toLowerCase();
  const asksLastReview = q.includes("last review") || q.includes("what did the review say") || q.includes("latest review");
  const asksMostAccurate = q.includes("most accurate") || q.includes("highest accuracy") || q.includes("best agent");
  const asksPatterns = q.includes("patterns keep coming") || q.includes("patterns keep coming up") || q.includes("recurring pattern") || q.includes("keep coming up");

  const noReviewMessage = "No AI review imported yet. Generate a report, paste it to Claude, and import the result to help me learn.";

  if (!asksLastReview && !asksMostAccurate && !asksPatterns) {
    return null;
  }

  if (asksLastReview) {
    if (!params.lastReviewDate || !params.lastReviewSummary) return noReviewMessage;

    const latest = params.recentReviews[params.recentReviews.length - 1];
    if (!latest) {
      return `The last AI review was imported on ${params.lastReviewDate}. Summary: ${params.lastReviewSummary}.`;
    }

    return [
      `The last AI review was imported on ${latest.importedAt}.`,
      `It processed ${latest.verdictsProcessed} verdict(s), with ${latest.realBugCount} real bug(s) and ${latest.falsePositiveCount} false positive(s).`,
      `Summary: ${latest.implementedFixSummary}`,
    ].join(" ");
  }

  if (asksMostAccurate) {
    const best = findMostAccurateAgent(params.agents);
    if (!best) return "I do not have enough agent telemetry yet to rank accuracy.";
    return `${best.name} is currently the most accurate agent at ${best.accuracyPercent.toFixed(1)}% confirmed true-positive rate (${best.role}).`;
  }

  if (asksPatterns) {
    if (!params.lastReviewDate) return noReviewMessage;
    if (params.confirmedPatterns.length === 0) return "I do not have confirmed recurring bug patterns yet from imported reviews.";
    return `The patterns that keep coming up are ${params.confirmedPatterns.slice(0, 3).join(", ")}.`;
  }

  return null;
}

function toPascalCase(input: string): string {
  return input
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  if (!pascal) return "main";
  return pascal[0].toLowerCase() + pascal.slice(1);
}

function uniqueTop(values: string[], countValue: number): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, countValue);
}

function extractFunctionNamesFromContent(filePath: string, content: string): string[] {
  const ext = extname(filePath.toLowerCase());
  const found: string[] = [];
  const pushMatches = (regex: RegExp) => {
    let match = regex.exec(content);
    while (match) {
      if (match[1]) found.push(match[1]);
      match = regex.exec(content);
    }
  };

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    pushMatches(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g);
    pushMatches(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function\s*\()/g);
    pushMatches(/exports\.([A-Za-z_$][\w$]*)\s*=/g);
    pushMatches(/module\.exports\s*=\s*\{\s*([^}]+)\s*\}/g);
  } else if (ext === ".py") {
    pushMatches(/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm);
  } else if (ext === ".go") {
    pushMatches(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/gm);
  } else if (ext === ".rs") {
    pushMatches(/(?:pub\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/g);
  }

  return uniqueTop(found, 3);
}

function inferFunctionNamesFromFilePath(filePath: string, complexity: number): string[] {
  const stem = basename(filePath, extname(filePath));
  const camel = toCamelCase(stem);
  const pascal = toPascalCase(stem);

  const candidates = [
    camel,
    `validate${pascal}`,
    complexity >= 16 ? `handle${pascal}Error` : `build${pascal}`,
  ];

  return uniqueTop(candidates, 3);
}

function inferTestType(filePath: string): "unit" | "integration" | "e2e" {
  const lower = filePath.toLowerCase();
  if (lower.includes("/e2e/") || lower.includes("playwright") || lower.includes("cypress")) return "e2e";
  if (lower.includes("/api/") || lower.includes("controller") || lower.includes("route") || lower.includes("handler")) return "integration";
  return "unit";
}

function inferPriority(building: Building): "critical" | "high" | "medium" {
  if (building.complexity >= 18 || building.testCoverage <= 0.03) return "critical";
  if (building.complexity >= 12 || building.testCoverage <= 0.1) return "high";
  return "medium";
}

function toRecommendedTestFilePath(filePath: string): string {
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  const stem = basename(filePath, extname(filePath));
  const ext = extname(filePath).toLowerCase();

  let nextFile = `${stem}.test.ts`;
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) nextFile = `${stem}.test.js`;
  else if (ext === ".py") nextFile = `${stem}_test.py`;
  else if (ext === ".go") nextFile = `${stem}_test.go`;
  else if (ext === ".rs") nextFile = `${stem}.test.rs`;

  return dir ? `${dir}/${nextFile}` : nextFile;
}

function buildTestRecommendationReason(building: Building): string {
  if (building.complexity >= 18) {
    return "this is one of the highest-complexity paths and can break city behavior quickly.";
  }
  if (!building.hasTests || building.testCoverage < 0.1) {
    return "coverage is too low, so regressions here are likely to go undetected.";
  }
  return "this file has meaningful logic and medium-to-high risk impact.";
}

async function buildTestRecommendations(params: {
  snapshot: CitySnapshot;
  repoUrl: string | null;
  branch: string;
  limit: number;
}): Promise<TestRecommendation[]> {
  const candidates = params.snapshot.allBuildings
    .filter(isUrgencySourceBuilding)
    .filter(building => !building.hasTests || building.testCoverage < 0.1)
    .sort((a, b) => (b.complexity - a.complexity) || (b.linesOfCode - a.linesOfCode))
    .slice(0, params.limit);

  const recommendations: TestRecommendation[] = [];

  for (const building of candidates) {
    const fileContent = await fetchGithubFileContent(params.repoUrl, params.branch, building.filePath);
    const parsedNames = fileContent ? extractFunctionNamesFromContent(building.filePath, fileContent) : [];
    const inferredNames = inferFunctionNamesFromFilePath(building.filePath, building.complexity);
    const whatToTest = uniqueTop(parsedNames.length > 0 ? parsedNames : inferredNames, 3);

    recommendations.push({
      buildingId: building.id,
      sourceFilePath: building.filePath,
      testFilePath: toRecommendedTestFilePath(building.filePath),
      whatToTest,
      testType: inferTestType(building.filePath),
      priority: inferPriority(building),
    });
  }

  return recommendations;
}

function statusLine(snapshot: CitySnapshot, criticalEvents: number, activeAgents: number): string {
  if (snapshot.totalBuildings === 0) {
    return "STATUS: No repository is loaded yet.";
  }

  if (snapshot.fireBuildings.length > 0 || criticalEvents > 0) {
    return `STATUS: Critical risk with ${snapshot.fireBuildings.length} unstable building(s) and ${criticalEvents} critical event(s).`;
  }

  if (snapshot.healthScore < 70 || snapshot.untestedBuildings > Math.max(5, Math.floor(snapshot.totalBuildings * 0.25))) {
    return `STATUS: Elevated risk; health ${Math.round(snapshot.healthScore)} with ${snapshot.untestedBuildings} under-tested building(s).`;
  }

  return `STATUS: Stable city health at ${Math.round(snapshot.healthScore)} with ${activeAgents} active agent(s).`;
}

function compactText(text: string, max = 280): string {
  return text.replace(/\s+/g, " ").slice(0, max);
}

function isUrgencySourceFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const lowerPath = normalizedPath.toLowerCase();
  const fileName = basename(lowerPath);
  const ext = extname(fileName);

  if (fileName === ".env" || fileName.startsWith(".env.")) return false;
  if (URGENCY_DOC_EXTENSIONS.has(ext)) return false;
  if (URGENCY_DOC_NAME_MARKERS.some(marker => fileName.includes(marker))) return false;

  return URGENCY_SOURCE_EXTENSIONS.has(ext);
}

function isUrgencySourceBuilding(building: Building): boolean {
  return isUrgencySourceFile(building.filePath);
}

function parseEventTimestamp(value: string): number | null {
  const isoLike = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = isoLike.endsWith("Z") ? isoLike : `${isoLike}Z`;
  const parsed = Date.parse(withZone);
  if (!Number.isNaN(parsed)) return parsed;

  const fallback = Date.parse(value);
  return Number.isNaN(fallback) ? null : fallback;
}

function isRecentEvent(event: MayorEventRow, windowMinutes: number): boolean {
  const eventTs = parseEventTimestamp(event.timestamp);
  if (eventTs === null) return false;
  return Date.now() - eventTs <= windowMinutes * 60_000;
}

function extractEventFilePath(event: MayorEventRow): string | null {
  const fromBuilding = event.buildingName?.trim();
  if (fromBuilding) {
    return fromBuilding.replace(/\\/g, "/");
  }

  const fileMatch = event.message.match(/([\w./-]+\.(ts|js|py|go|rs|md|mdx|txt|yaml|yml|json))/i);
  if (!fileMatch?.[1]) return null;
  return fileMatch[1].replace(/\\/g, "/");
}

function isMayorSourceFilePath(filePath: string | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  const ext = extname(basename(lower));
  return MAYOR_SOURCE_FILE_EXTENSIONS.has(ext);
}

function isMayorExcludedDocFilePath(filePath: string | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  const ext = extname(basename(lower));
  return MAYOR_EXCLUDED_DOC_EXTENSIONS.has(ext);
}

function includeEventInMayorContext(event: MayorEventRow): boolean {
  if (event.type !== "bug_found" && event.type !== "test_passed") {
    return true;
  }

  const filePath = extractEventFilePath(event);
  if (!filePath) return false;
  if (isMayorExcludedDocFilePath(filePath)) return false;
  return isMayorSourceFilePath(filePath);
}

function trimFileContentForPrompt(content: string, maxChars = 12000): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[truncated to first ${maxChars} chars]`;
}

function resolveMayorFilePathFromQuestion(question: string, snapshot: CitySnapshot): string | null {
  const sourcePaths = snapshot.allBuildings
    .map(building => building.filePath.replace(/\\/g, "/"))
    .filter(filePath => MAYOR_FILE_QUERY_EXTENSIONS.has(extname(filePath.toLowerCase())));

  const sourcePathSet = new Set(sourcePaths.map(path => path.toLowerCase()));
  const lowerQuestion = question.toLowerCase();
  const matches = question.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];

  for (const rawCandidate of matches) {
    const cleaned = rawCandidate.replace(/^['"`(]+|[)"'`.,:;!?]+$/g, "");
    const lower = cleaned.toLowerCase();
    const ext = extname(lower);
    if (!MAYOR_FILE_QUERY_EXTENSIONS.has(ext)) continue;

    if (sourcePathSet.has(lower)) {
      const exact = sourcePaths.find(path => path.toLowerCase() === lower);
      if (exact) return exact;
    }

    const suffix = `/${lower}`;
    const bySuffix = sourcePaths.find(path => path.toLowerCase().endsWith(suffix));
    if (bySuffix) return bySuffix;
  }

  for (const path of sourcePaths) {
    const fileName = basename(path).toLowerCase();
    if (lowerQuestion.includes(fileName)) return path;
  }

  return null;
}

function filePathMatchScore(filePath: string, candidate: string): number {
  const normalizedPath = normalizePathForLookup(filePath).toLowerCase();
  const normalizedCandidate = normalizePathForLookup(candidate).toLowerCase();

  if (!normalizedPath || !normalizedCandidate) return 0;
  if (normalizedPath === normalizedCandidate) return 100;
  if (normalizedPath.endsWith(`/${normalizedCandidate}`) || normalizedCandidate.endsWith(`/${normalizedPath}`)) return 95;

  const pathBase = basename(normalizedPath);
  const candidateBase = basename(normalizedCandidate);
  if (pathBase === candidateBase) return 90;

  const pathStem = basename(pathBase, extname(pathBase));
  const candidateStem = basename(candidateBase, extname(candidateBase));
  if (pathStem && pathStem === candidateStem) return 85;

  if (normalizedPath.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedPath)) return 70;
  if (pathStem && candidateStem && (pathStem.includes(candidateStem) || candidateStem.includes(pathStem))) return 60;
  return 0;
}

function filePathMatchesCandidate(filePath: string, candidate: string): boolean {
  return filePathMatchScore(filePath, candidate) >= 85;
}

type MayorTelemetryBuilding = {
  normalizedFilePath: string;
  complexity: number | null;
  coveragePercent: number | null;
  linesOfCode: number | null;
  lastAnalyzed: string | null;
  bugCount: number;
  status: string | null;
};

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toCoveragePercent(value: unknown): number | null {
  const numeric = toNullableNumber(value);
  if (numeric === null) return null;
  if (numeric <= 1) return Math.round(Math.max(0, Math.min(1, numeric)) * 100);
  return Math.round(Math.max(0, Math.min(100, numeric)));
}

function toMayorTelemetryBuilding(raw: unknown): MayorTelemetryBuilding | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const filePathValue = typeof record.filePath === "string"
    ? record.filePath
    : typeof record.path === "string"
      ? record.path
      : "";

  const normalizedFilePath = normalizePathForLookup(filePathValue);
  if (!normalizedFilePath) return null;

  return {
    normalizedFilePath,
    complexity: toNullableNumber(record.complexity),
    coveragePercent: toCoveragePercent(record.testCoverage),
    linesOfCode: toNullableNumber(record.linesOfCode) ?? toNullableNumber(record.loc),
    lastAnalyzed: typeof record.lastAnalyzed === "string" && record.lastAnalyzed.trim()
      ? record.lastAnalyzed
      : null,
    bugCount: Math.max(0, Math.round(toNullableNumber(record.bugCount) ?? 0)),
    status: typeof record.status === "string" && record.status.trim()
      ? record.status
      : null,
  };
}

function telemetryCompletenessScore(building: MayorTelemetryBuilding): number {
  let score = 0;
  if (building.complexity !== null) score += 1;
  if (building.coveragePercent !== null) score += 1;
  if (building.linesOfCode !== null) score += 1;
  if (building.lastAnalyzed) score += 1;
  if (building.status) score += 1;
  if (building.bugCount > 0) score += 1;
  return score;
}

function findBestTelemetryBuildingMatch(buildings: MayorTelemetryBuilding[], candidates: string[]): {
  building: MayorTelemetryBuilding;
  score: number;
  completeness: number;
} | null {
  let best: { building: MayorTelemetryBuilding; score: number; completeness: number } | null = null;

  for (const building of buildings) {
    const score = candidates.reduce((currentBest, candidate) => {
      return Math.max(currentBest, filePathMatchScore(building.normalizedFilePath, candidate));
    }, 0);
    if (score <= 0) continue;

    const completeness = telemetryCompletenessScore(building);
    if (!best || score > best.score || (score === best.score && completeness > best.completeness)) {
      best = { building, score, completeness };
    }
  }

  return best;
}

function extractEventFileCandidates(event: MayorEventRow): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string | null | undefined): void => {
    if (!raw) return;
    const normalized = normalizePathForLookup(raw.trim());
    if (!normalized) return;

    const lower = normalized.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    candidates.push(normalized);
  };

  addCandidate(event.filePath ?? null);
  addCandidate(event.buildingName ?? null);
  addCandidate(extractEventFilePath(event));

  const fromMessage = event.message.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
  for (const token of fromMessage) addCandidate(token);

  return candidates;
}

function collectTaskCompletionVisits(events: MayorEventRow[], canonicalPath: string): {
  taskCompletionAgents: string[];
  taskCompletionCount: number;
} {
  const taskCompletionAgents = new Set<string>();
  let taskCompletionCount = 0;

  for (const event of events) {
    if (event.type !== "task_complete") continue;
    const eventFiles = extractEventFileCandidates(event);
    if (eventFiles.length === 0) continue;

    const matchesFile = eventFiles.some(candidate => filePathMatchesCandidate(candidate, canonicalPath));
    if (!matchesFile) continue;

    taskCompletionCount += 1;
    if (event.agentName) taskCompletionAgents.add(event.agentName);
  }

  return {
    taskCompletionAgents: Array.from(taskCompletionAgents).slice(0, 6),
    taskCompletionCount,
  };
}

async function resolveMayorTelemetryBuilding(candidates: string[], snapshot: CitySnapshot): Promise<MayorTelemetryBuilding | null> {
  const normalizedCandidates = Array.from(new Set(
    candidates
      .map(candidate => normalizePathForLookup(candidate))
      .filter(Boolean)
  ));

  if (normalizedCandidates.length === 0) return null;

  const snapshotBuildings = snapshot.allBuildings
    .map(building => toMayorTelemetryBuilding(building))
    .filter((building): building is MayorTelemetryBuilding => Boolean(building));

  let bestMatch = findBestTelemetryBuildingMatch(snapshotBuildings, normalizedCandidates);
  if (bestMatch?.score === 100) return bestMatch.building;

  try {
    const repoRows = await db
      .select({ layoutData: reposTable.layoutData })
      .from(reposTable)
      .orderBy(desc(reposTable.isActive), desc(reposTable.updatedAt))
      .limit(8);

    for (const row of repoRows) {
      const layout = parseLayout(row.layoutData ?? null);
      if (!layout || !Array.isArray(layout.districts)) continue;

      const buildings = layout.districts
        .flatMap(district => district.buildings ?? [])
        .map(building => toMayorTelemetryBuilding(building))
        .filter((building): building is MayorTelemetryBuilding => Boolean(building));

      const candidateMatch = findBestTelemetryBuildingMatch(buildings, normalizedCandidates);
      if (!candidateMatch) continue;

      if (!bestMatch || candidateMatch.score > bestMatch.score || (candidateMatch.score === bestMatch.score && candidateMatch.completeness > bestMatch.completeness)) {
        bestMatch = candidateMatch;
      }

      if (bestMatch.score === 100 && bestMatch.completeness >= 3) {
        break;
      }
    }
  } catch {
    // Keep best known telemetry from snapshot if DB fallback fails.
  }

  return bestMatch?.building ?? null;
}

function parseVisitedFiles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map(entry => normalizePathForLookup(entry));
  } catch {
    return [];
  }
}

async function buildMayorFileAdviceContext(params: {
  message: string;
  snapshot: CitySnapshot;
  events: MayorEventRow[];
  agents: Array<typeof agentsTable.$inferSelect>;
}): Promise<MayorFileAdviceContext | null> {
  const mentioned = extractMentionedFileCandidates(params.message);
  const resolvedFromSnapshot = resolveMayorFilePathFromQuestion(params.message, params.snapshot);
  const requestedFile = resolvedFromSnapshot ?? mentioned[0] ?? null;
  if (!requestedFile) return null;

  const lookupCandidates = Array.from(new Set([
    requestedFile,
    resolvedFromSnapshot ?? "",
    ...mentioned,
  ].filter(Boolean).map(value => normalizePathForLookup(value))));

  const telemetryBuilding = await resolveMayorTelemetryBuilding(lookupCandidates, params.snapshot);
  const canonicalPath = telemetryBuilding?.normalizedFilePath ?? normalizePathForLookup(requestedFile);

  const matchingEvents = params.events.filter(event => {
    const eventFiles = extractEventFileCandidates(event);
    if (eventFiles.length === 0) return false;
    return eventFiles.some(eventFile => filePathMatchesCandidate(eventFile, canonicalPath));
  });

  const bugEvents = matchingEvents.filter(event => event.type === "bug_found");
  const findings = bugEvents
    .slice(0, 5)
    .map(event => {
      const agent = event.agentName ?? "Unknown agent";
      const detail = compactText(event.findingText ?? event.message, 170);
      const reference = event.codeReference ? ` (${compactText(event.codeReference, 80)})` : "";
      return `${agent}: ${detail}${reference}`;
    });

  const visitedByAgents = new Set<string>();
  for (const agent of params.agents) {
    const visitedFiles = parseVisitedFiles(agent.visitedFiles);
    if (visitedFiles.some(path => filePathMatchesCandidate(path, canonicalPath))) {
      visitedByAgents.add(agent.name);
    }
  }

  for (const event of matchingEvents) {
    if (event.agentName) visitedByAgents.add(event.agentName);
  }

  const taskCompletionVisits = collectTaskCompletionVisits(params.events, canonicalPath);
  for (const agentName of taskCompletionVisits.taskCompletionAgents) {
    visitedByAgents.add(agentName);
  }

  const bugCount = Math.max(telemetryBuilding?.bugCount ?? 0, bugEvents.length);

  return {
    requestedFile,
    normalizedFilePath: canonicalPath,
    complexity: telemetryBuilding?.complexity ?? null,
    coveragePercent: telemetryBuilding?.coveragePercent ?? null,
    linesOfCode: telemetryBuilding?.linesOfCode ?? null,
    lastAnalyzed: telemetryBuilding?.lastAnalyzed ?? null,
    bugCount,
    status: telemetryBuilding?.status ?? null,
    agentsVisited: Array.from(visitedByAgents).slice(0, 6),
    taskCompletionAgents: taskCompletionVisits.taskCompletionAgents,
    taskCompletionCount: taskCompletionVisits.taskCompletionCount,
    findings,
  };
}

function formatMayorFileAdviceForPrompt(context: MayorFileAdviceContext): string {
  const complexity = context.complexity ?? "unknown";
  const coverage = context.coveragePercent === null ? "unknown" : `${context.coveragePercent}%`;
  const linesOfCode = context.linesOfCode === null ? "unknown" : String(context.linesOfCode);
  const lastAnalyzed = context.lastAnalyzed ?? "unknown";
  const status = context.status ?? "unknown";
  const visited = context.agentsVisited.length > 0 ? context.agentsVisited.join(", ") : "none recorded";
  const taskVisits = context.taskCompletionAgents.length > 0
    ? `${context.taskCompletionAgents.join(", ")} (${context.taskCompletionCount} completion records)`
    : context.taskCompletionCount > 0
      ? `${context.taskCompletionCount} completion records`
      : "none recorded";
  const findings = context.findings.length > 0
    ? context.findings.map(item => `- ${item}`).join("\n")
    : "- no recent file-specific findings";

  return [
    `File context for ${context.normalizedFilePath}:`,
    `- Complexity: ${complexity}`,
    `- Coverage: ${coverage}`,
    `- LOC: ${linesOfCode}`,
    `- Status: ${status}`,
    `- Last analyzed: ${lastAnalyzed}`,
    `- Bug count: ${context.bugCount}`,
    `- Agents from task completions: ${taskVisits}`,
    `- Agents touched (all signals): ${visited}`,
    "- What agents found:",
    findings,
  ].join("\n");
}

function buildMayorFileAdviceFallbackReply(context: MayorFileAdviceContext, options?: { sourceBodyUnavailable?: boolean }): string {
  const complexity = context.complexity === null ? "unknown" : String(context.complexity);
  const coverage = context.coveragePercent === null ? "unknown" : `${context.coveragePercent}%`;
  const linesOfCode = context.linesOfCode === null ? "unknown" : String(context.linesOfCode);
  const status = context.status ?? "unknown";
  const lastAnalyzed = context.lastAnalyzed ?? "unknown";
  const finding = context.findings[0] ?? "No specific finding text is stored yet for this file.";
  const visited = context.agentsVisited.length > 0 ? context.agentsVisited.join(", ") : "no recorded agents";
  const completionVisits = context.taskCompletionAgents.length > 0
    ? `${context.taskCompletionAgents.join(", ")} (${context.taskCompletionCount} completion records)`
    : context.taskCompletionCount > 0
      ? `${context.taskCompletionCount} completion records without agent names`
      : "no recorded task completion visits";
  const finalSentence = options?.sourceBodyUnavailable
    ? "I cannot read the live source body right now, so I would start by splitting the highest-complexity branch and adding one focused regression test around the top bug path."
    : "I would split the highest-complexity branch first and add a focused regression test around the bug path before wider refactors.";

  return [
    `I have telemetry for ${context.normalizedFilePath}: complexity ${complexity}, coverage ${coverage}, LOC ${linesOfCode}, status ${status}, last analyzed ${lastAnalyzed}, and bug count ${context.bugCount}.`,
    `Task-completion visits: ${completionVisits}; broader agent touches: ${visited}; top finding: ${finding}`,
    finalSentence,
  ].join(" ");
}

function buildMayorFileTelemetryLead(context: MayorFileAdviceContext): string {
  const complexity = context.complexity === null ? "unknown" : String(context.complexity);
  const coverage = context.coveragePercent === null ? "unknown" : `${context.coveragePercent}%`;
  const linesOfCode = context.linesOfCode === null ? "unknown" : String(context.linesOfCode);
  const lastAnalyzed = context.lastAnalyzed ?? "unknown";
  const status = context.status ?? "unknown";
  const completionVisits = context.taskCompletionAgents.length > 0
    ? `${context.taskCompletionAgents.join(", ")} (${context.taskCompletionCount} completion records)`
    : context.taskCompletionCount > 0
      ? `${context.taskCompletionCount} completion records without agent names`
      : "none recorded";

  return `For ${context.normalizedFilePath}, telemetry shows complexity ${complexity}, coverage ${coverage}, LOC ${linesOfCode}, last analyzed ${lastAnalyzed}, bug count ${context.bugCount}, status ${status}, and task-completion visits ${completionVisits}.`;
}

function findEventFileName(event: MayorEventRow): string {
  const pathLike = extractEventFilePath(event);
  if (pathLike) return basename(pathLike);

  return "unknown-file";
}

function collectRecentBugSummaries(events: MayorEventRow[]): RecentBugSummary[] {
  return events
    .filter(event => event.type === "bug_found")
    .filter(event => {
      const filePath = extractEventFilePath(event);
      if (!filePath) return false;
      if (isMayorExcludedDocFilePath(filePath)) return false;
      return isMayorSourceFilePath(filePath);
    })
    .slice(0, 5)
    .map(event => ({
      fileName: findEventFileName(event),
      detail: compactText(event.message, 160),
      timestamp: event.timestamp,
    }));
}

function buildMayorCityContext(params: {
  snapshot: CitySnapshot;
  activeAgents: number;
  idleAgents: number;
  recentBugSummaries: RecentBugSummary[];
  kbEntries: number;
  kbHitRatePercent: number;
  lastFiveEvents: MayorEventRow[];
}): string {
  const recentBugsText = params.recentBugSummaries.length > 0
    ? params.recentBugSummaries.map(b => `${b.fileName}: ${b.detail}`).join(" | ")
    : "none";

  const recentEventsText = params.lastFiveEvents.length > 0
    ? params.lastFiveEvents.map(e => `[${e.type}] ${compactText(e.message, 140)}`).join(" | ")
    : "none";

  return [
    `- Health: ${Math.round(params.snapshot.healthScore)}/100, Season: ${params.snapshot.season}`,
    `- Active agents: ${params.activeAgents}, Idle: ${params.idleAgents}`,
    `- Buildings: ${params.snapshot.totalBuildings}, Untested: ${params.snapshot.untestedBuildings}`,
    `- Recent bugs: ${recentBugsText}`,
    `- KB entries: ${params.kbEntries}, hit rate: ${params.kbHitRatePercent}%`,
    `- Recent events: ${recentEventsText}`,
  ].join("\n");
}

function isComplexMayorPrompt(question: string): boolean {
  const q = question.toLowerCase();
  return [
    "how to",
    "why",
    "strategy",
    "plan",
    "roadmap",
    "architecture",
    "refactor",
    "tradeoff",
    "recommend",
    "suggest",
    "design",
    "generate",
    "write",
    "create",
    "fix",
    "root cause",
    "next step",
    "what should",
  ].some(token => q.includes(token));
}

function buildDbStatsMayorReply(params: {
  message: string;
  snapshot: CitySnapshot;
  activeAgents: number;
  idleAgents: number;
  events: MayorEventRow[];
}): string | null {
  const q = params.message.toLowerCase();
  const asksHealth = q.includes("health score") || q.includes("city health") || q === "health";
  const asksActiveAgents = q.includes("active agents") || q.includes("agents active") || q.includes("how many agents");
  const asksBugCount = q.includes("bug count") || q.includes("how many bugs") || q.includes("bugs found") || q.includes("number of bugs");
  const asksCoverage = q.includes("test coverage") || q.includes("coverage");

  const asksSimpleStats = asksHealth || asksActiveAgents || asksBugCount || asksCoverage;
  if (!asksSimpleStats || isComplexMayorPrompt(q)) return null;

  const parts: string[] = [];
  if (asksHealth) {
    parts.push(`Health score is ${Math.round(params.snapshot.healthScore)} out of 100.`);
  }

  if (asksActiveAgents) {
    parts.push(`Active agents: ${params.activeAgents}, idle agents: ${params.idleAgents}.`);
  }

  if (asksBugCount) {
    const recentBugCount = params.events.filter(event => event.type === "bug_found").length;
    parts.push(`Recent bug findings in the latest event window: ${recentBugCount}.`);
  }

  if (asksCoverage) {
    const sourceBuildings = params.snapshot.allBuildings.filter(isUrgencySourceBuilding);
    const averageCoverage = sourceBuildings.length > 0
      ? Math.round((sourceBuildings.reduce((sum, building) => sum + building.testCoverage, 0) / sourceBuildings.length) * 100)
      : 0;
    parts.push(`Average source-file test coverage is ${averageCoverage}% across ${sourceBuildings.length} buildings.`);
  }

  return `I checked live city telemetry. ${parts.join(" ")}`.trim();
}

function buildSprintPlanMarkdown(params: {
  generatedAt: string;
  snapshot: CitySnapshot;
  activeAgents: number;
  idleAgents: number;
  recentBugSummaries: RecentBugSummary[];
  recommendations: TestRecommendation[];
}): string {
  const fireTargets = params.snapshot.fireBuildings
    .filter(isUrgencySourceBuilding)
    .slice(0, 5);

  const fireTargetIds = new Set(fireTargets.map(target => target.id));
  const highRiskTargets = params.snapshot.highRiskBuildings
    .filter(isUrgencySourceBuilding)
    .filter(target => !fireTargetIds.has(target.id))
    .slice(0, 5);

  const testTargets = params.recommendations.slice(0, 5);

  const lines = [
    "# Mayor Sprint Plan",
    "",
    `Generated: ${params.generatedAt}`,
    `Current health: ${Math.round(params.snapshot.healthScore)}/100`,
    `Agent capacity: ${params.activeAgents} active, ${params.idleAgents} idle`,
    "",
    "## Sprint Goal",
    `Raise city health by reducing fires and increasing coverage on high-complexity source files in ${params.snapshot.repoName}.`,
    "",
    "## Day 1 - Stabilize Production Risk",
  ];

  if (fireTargets.length === 0) {
    lines.push("- No source-code fires are active; monitor telemetry and keep incident response on standby.");
  } else {
    for (const building of fireTargets) {
      lines.push(`- Fix ${building.filePath} first (status: ${building.status}, complexity: ${building.complexity}).`);
    }
  }

  lines.push(
    "",
    "## Day 2 - Kill High-Risk Coverage Gaps",
  );

  if (highRiskTargets.length === 0) {
    lines.push("- High-risk queue is currently clear; shift focus to regression-proofing recently fixed files.");
  } else {
    for (const building of highRiskTargets) {
      lines.push(`- Increase coverage for ${building.filePath} (coverage: ${Math.round(building.testCoverage * 100)}%, complexity: ${building.complexity}).`);
    }
  }

  lines.push(
    "",
    "## Day 3 - Lock In Test Reliability",
  );

  if (testTargets.length === 0) {
    lines.push("- No ranked test targets are available yet; regenerate the urgency report after next patrol cycle.");
  } else {
    for (const recommendation of testTargets) {
      lines.push(`- Create ${recommendation.testFilePath} for ${recommendation.sourceFilePath} (${recommendation.priority} priority).`);
    }
  }

  lines.push("", "## Recent Bug Signals");

  if (params.recentBugSummaries.length === 0) {
    lines.push("- No recent bug events found in source-file telemetry.");
  } else {
    for (const bug of params.recentBugSummaries.slice(0, 5)) {
      lines.push(`- ${bug.fileName}: ${bug.detail}`);
    }
  }

  lines.push(
    "",
    "## Exit Criteria",
    "- No fire/error source files remain.",
    "- Coverage is improved on the top high-risk files.",
    "- A fresh urgency report shows reduced critical and high buckets.",
  );

  return lines.join("\n");
}

function buildWeeklySummaryMarkdown(params: {
  generatedAt: string;
  rangeLabel: string;
  snapshot: CitySnapshot;
  activeAgents: number;
  idleAgents: number;
  events: MayorEventRow[];
}): string {
  const totalEvents = params.events.length;
  const bugEvents = params.events.filter(event => event.type === "bug_found");
  const testEvents = params.events.filter(event => event.type === "test_passed");
  const escalationEvents = params.events.filter(event => event.type === "escalation");
  const criticalEvents = params.events.filter(event => event.severity === "critical");
  const warningEvents = params.events.filter(event => event.severity === "warning");

  const hotspotCounts = new Map<string, number>();
  for (const event of bugEvents) {
    const filePath = extractEventFilePath(event);
    if (!filePath || !isUrgencySourceFile(filePath)) continue;
    hotspotCounts.set(filePath, (hotspotCounts.get(filePath) ?? 0) + 1);
  }

  const hotspots = Array.from(hotspotCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const highRiskUntested = params.snapshot.highRiskBuildings
    .filter(isUrgencySourceBuilding)
    .filter(building => !building.hasTests || building.testCoverage < 0.2)
    .slice(0, 5);

  const lines = [
    "# Weekly Engineering Summary",
    "",
    `Generated: ${params.generatedAt}`,
    `Coverage window: ${params.rangeLabel}`,
    "",
    "## City Snapshot",
    `- Health: ${Math.round(params.snapshot.healthScore)}/100`,
    `- Buildings tracked: ${params.snapshot.totalBuildings}`,
    `- Untested or low-coverage buildings: ${params.snapshot.untestedBuildings}`,
    `- Agents: ${params.activeAgents} active, ${params.idleAgents} idle`,
    "",
    "## Event Totals",
    `- Total events: ${totalEvents}`,
    `- Bugs found: ${bugEvents.length}`,
    `- Tests passed: ${testEvents.length}`,
    `- Escalations: ${escalationEvents.length}`,
    `- Critical events: ${criticalEvents.length}`,
    `- Warning events: ${warningEvents.length}`,
    "",
    "## Bug Hotspots",
  ];

  if (hotspots.length === 0) {
    lines.push("- No source-file bug hotspots detected in the selected window.");
  } else {
    for (const [filePath, countValue] of hotspots) {
      lines.push(`- ${filePath}: ${countValue} bug event(s)`);
    }
  }

  lines.push("", "## Priority Risks Next Week");

  if (highRiskUntested.length === 0) {
    lines.push("- No high-risk untested source files detected; keep regression checks active.");
  } else {
    for (const building of highRiskUntested) {
      lines.push(`- ${building.filePath} (complexity ${building.complexity}, coverage ${Math.round(building.testCoverage * 100)}%)`);
    }
  }

  lines.push(
    "",
    "## Recommended Focus",
    "- Keep critical incidents at zero by triaging fire/error files first.",
    "- Convert repeated bug hotspots into explicit test cases.",
    "- Re-run the urgency report at end of sprint to measure risk reduction.",
  );

  return lines.join("\n");
}

function buildSpecificMayorReply(params: {
  message: string;
  snapshot: CitySnapshot;
  events: MayorEventRow[];
  activeAgents: number;
  idleAgents: number;
  recentBugSummaries: RecentBugSummary[];
  testRecommendations?: TestRecommendation[];
}): string | null {
  const q = params.message.toLowerCase();
  const hasRecentTaskCompletions = params.events.filter(event => (
    MAYOR_TASK_EVENT_TYPES.has(event.type)
    && event.agentId
    && isRecentEvent(event, 5)
    && (
      event.type === "escalation"
      || (() => {
        const filePath = extractEventFilePath(event);
        return isMayorSourceFilePath(filePath) && !isMayorExcludedDocFilePath(filePath);
      })()
    )
  ));

  const worstUntested = params.snapshot.allBuildings
    .filter(isUrgencySourceBuilding)
    .filter(building => !building.hasTests || building.testCoverage < 0.1)
    .sort((a, b) => (b.complexity - a.complexity) || (b.linesOfCode - a.linesOfCode))[0];

  const asksBugs = q.includes("what bugs did you find") || (q.includes("what bugs") && q.includes("find"));
  if (asksBugs) {
    if (params.recentBugSummaries.length === 0) {
      return "I do not see any recent bug findings in the event stream right now. Run targeted analysis and I will report exact filenames and findings immediately.";
    }

    const list = params.recentBugSummaries
      .slice(0, 4)
      .map(summary => `${summary.fileName}: ${summary.detail}`)
      .join("; ");

    return `Recent bug findings are ${list}. The latest recorded bug event was at ${params.recentBugSummaries[0].timestamp}.`;
  }

  const asksWorstFile = q.includes("which file is worst") || q.includes("worst file");
  if (asksWorstFile) {
    if (!worstUntested) {
      return "I do not have an untested source file to flag as worst right now. The next best move is to review high-complexity files and keep coverage above 80%.";
    }

    return `The worst untested file is ${worstUntested.filePath}, with complexity ${worstUntested.complexity} and ${Math.round(worstUntested.testCoverage * 100)}% coverage. Start with focused tests and bug analysis there first, because it gives the biggest risk reduction per change.`;
  }

  const asksAgentsWorking = q.includes("are the agents working") || q.includes("agents working");
  if (asksAgentsWorking) {
    if (hasRecentTaskCompletions.length > 0) {
      const agentNames = Array.from(new Set(hasRecentTaskCompletions.map(event => event.agentName).filter(Boolean)))
        .slice(0, 3)
        .join(", ");
      const evidence = agentNames.length > 0 ? ` by ${agentNames}` : "";

      return `Yes, agents are working: I see ${hasRecentTaskCompletions.length} completion events in the last 5 minutes${evidence}. Current roster is ${params.activeAgents} active and ${params.idleAgents} idle agents.`;
    }

    return `No, I do not see task-completion events in the last 5 minutes, so execution is effectively stalled. I currently show ${params.activeAgents} active and ${params.idleAgents} idle agents, so trigger new analyze or test tasks and confirm fresh events.`;
  }

  const asksNotWorking = q.includes("what is not working")
    || q.includes("what's not working")
    || q.includes("what isnt working")
    || q.includes("what isn't working");
  if (asksNotWorking) {
    const issues: string[] = [];
    if (params.snapshot.fireBuildings.length > 0) {
      issues.push(`${params.snapshot.fireBuildings.length} buildings are in fire or error status.`);
    }
    if (params.snapshot.untestedBuildings > Math.max(5, Math.floor(params.snapshot.totalBuildings * 0.25))) {
      issues.push(`${params.snapshot.untestedBuildings} buildings are still untested or near-zero coverage.`);
    }
    if (hasRecentTaskCompletions.length === 0) {
      issues.push("There are no task-completion events in the last 5 minutes.");
    }

    if (issues.length === 0) {
      return "I do not see a hard failure in current telemetry right now. The main risk is keeping test coverage rising on high-complexity files so health does not regress.";
    }

    return `What is not working right now: ${issues.slice(0, 3).join(" ")} Focus recovery on those blockers first, then rerun the urgency report to confirm improvement.`;
  }

  const asksImproveHealth = q.includes("how do i improve the health score")
    || q.includes("improve the health score")
    || q.includes("improve health score");
  if (asksImproveHealth) {
    const topTargets = params.snapshot.highRiskBuildings
      .filter(isUrgencySourceBuilding)
      .slice(0, 3)
      .map(building => building.filePath);

    const targetText = topTargets.length > 0
      ? `, especially ${topTargets.join(", ")}`
      : "";

    return `To improve health score, clear fire or error buildings first and raise coverage on high-complexity source files${targetText}. Run analyze plus tests on those targets, fix the top findings, and regenerate the report to verify score movement.`;
  }

  const asksCreateTests = q.includes("test")
    && (q.includes("create") || q.includes("write") || q.includes("add") || q.includes("make"));
  if (asksCreateTests) {
    const recommendations = (params.testRecommendations ?? []).slice(0, 3);
    if (recommendations.length === 0) {
      return "I do not have enough source-file telemetry to rank test targets right now. Request a fresh urgency report and I will produce exact files and function targets.";
    }

    const lines = recommendations.map((rec, index) => {
      const building = params.snapshot.allBuildings.find(item => item.id === rec.buildingId);
      const reason = building ? buildTestRecommendationReason(building) : "this file is high-risk and under-tested.";
      const fn1 = rec.whatToTest[0] ?? "mainFlow";
      const fn2 = rec.whatToTest[1] ?? rec.whatToTest[0] ?? "errorHandling";
      return `${index + 1}. create ${rec.testFilePath} — test ${fn1}() and ${fn2}(), ${reason}`;
    });

    return [
      "Create these 3 test files now:",
      ...lines,
      "These are the highest-complexity untested source files, so they provide the fastest health-score improvement.",
    ].join("\n");
  }

  return null;
}

function ensureCompleteMayorReply(reply: string, fallbackSentences: string[]): string {
  const normalized = reply.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallbackSentences.slice(0, 2).join(" ");
  }

  const completeSentences = splitMayorSentences(normalized);
  const selected = completeSentences.slice(0, 3);

  for (const fallback of fallbackSentences) {
    if (selected.length >= 2) break;
    const trimmed = fallback.trim();
    if (!trimmed) continue;
    const withPunctuation = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    if (!selected.includes(withPunctuation)) {
      selected.push(withPunctuation);
    }
  }

  if (selected.length === 0) {
    return fallbackSentences.slice(0, 2).join(" ");
  }

  return selected.slice(0, 3).join(" ");
}

function protectMayorFileExtensions(text: string): string {
  return text.replace(/\.([a-z]{1,4})\b/gi, (_match, ext: string) => `__MAYOR_EXT_${ext.toLowerCase()}__`);
}

function restoreMayorFileExtensions(text: string): string {
  return text.replace(/__MAYOR_EXT_([a-z]{1,4})__/gi, (_match, ext: string) => `.${ext}`);
}

function splitMayorSentences(text: string): string[] {
  const protectedText = protectMayorFileExtensions(text);
  const sentences = protectedText.match(/[^.!?]+[.!?]/g)?.map(item => item.trim()).filter(Boolean) ?? [];
  return sentences.map(sentence => restoreMayorFileExtensions(sentence));
}

async function readOrchestratorModelSettings(): Promise<{ groqModel: string; mayorName: string }> {
  try {
    const rows = await db
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(inArray(settingsTable.key, [...ORCHESTRATOR_MODEL_KEYS]));

    const map = new Map(rows.map(row => [row.key, row.value]));
    const groqModel = normalizeGroqModel(map.get("groq_model") ?? "llama-3.3-70b-versatile");
    const mayorName = (map.get("mayor_name") ?? "Mayor").trim() || "Mayor";
    return { groqModel, mayorName };
  } catch {
    return { groqModel: "llama-3.3-70b-versatile", mayorName: "Mayor" };
  }
}

async function callGroqMayor(params: {
  model: string;
  systemPrompt: string;
  conversationHistory: MayorConversationEntry[];
  userMessage: string;
}): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("missing_groq_key");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: params.systemPrompt,
        },
        ...params.conversationHistory.map(entry => ({
          role: entry.role === "assistant" ? "assistant" : "user",
          content: entry.content,
        })),
        {
          role: "user",
          content: params.userMessage,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`groq_http_${res.status}:${compactText(body, 220)}`);
  }

  const payload = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("groq_empty_reply");
  return content;
}

function mayorModelMatches(candidate: string, preferred: string): boolean {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedPreferred = preferred.toLowerCase();
  if (normalizedCandidate === normalizedPreferred) return true;

  const preferredBase = normalizedPreferred.split(":")[0];
  return (
    normalizedCandidate.startsWith(`${normalizedPreferred}:`)
    || normalizedCandidate.startsWith(`${preferredBase}:`)
    || normalizedCandidate.startsWith(`${preferredBase}-`)
  );
}

function pickMayorOllamaModel(models: string[]): string | null {
  if (models.length === 0) return null;

  for (const preferred of MAYOR_OLLAMA_FALLBACK_MODELS) {
    const match = models.find((model) => mayorModelMatches(model, preferred));
    if (match) return match;
  }

  const qwenMini = models.find((model) => model.toLowerCase().includes("qwen2.5:0.5b"));
  if (qwenMini) return qwenMini;

  return models[0] ?? null;
}

function buildMayorOllamaPrompt(history: MayorConversationEntry[], userMessage: string): string {
  const historyText = history.length > 0
    ? history.map((entry) => `${entry.role === "assistant" ? "Mayor" : "User"}: ${entry.content}`).join("\n")
    : "none";

  return [
    "Conversation history:",
    historyText,
    "",
    "Latest user message:",
    userMessage,
    "",
    "Respond directly to the latest user message.",
  ].join("\n");
}

async function callOllamaMayor(params: {
  systemPrompt: string;
  conversationHistory: MayorConversationEntry[];
  userMessage: string;
}): Promise<{ content: string; model: string }> {
  const connection = await ollamaClient.testConnection();
  if (!connection.reachable) throw new Error("ollama_unreachable");

  const model = pickMayorOllamaModel(connection.models);
  if (!model) throw new Error("ollama_no_models");

  const prompt = buildMayorOllamaPrompt(params.conversationHistory, params.userMessage);
  const content = await ollamaClient.generate({
    model,
    system: params.systemPrompt,
    prompt,
    temperature: 0.2,
    maxTokens: 400,
  });

  if (!content.trim()) throw new Error("ollama_empty_reply");
  return { content, model };
}

async function callMayorWithFallback(params: {
  groqModel: string;
  systemPrompt: string;
  conversationHistory: MayorConversationEntry[];
  userMessage: string;
}): Promise<MayorAiResponse> {
  try {
    const content = await callGroqMayor({
      model: params.groqModel,
      systemPrompt: params.systemPrompt,
      conversationHistory: params.conversationHistory,
      userMessage: params.userMessage,
    });

    return {
      content,
      provider: "groq",
      model: params.groqModel,
    };
  } catch (groqError) {
    const fallbackReason = groqError instanceof Error ? groqError.message : String(groqError);

    try {
      const local = await callOllamaMayor({
        systemPrompt: params.systemPrompt,
        conversationHistory: params.conversationHistory,
        userMessage: params.userMessage,
      });

      return {
        content: local.content,
        provider: "ollama",
        model: local.model,
        fallbackReason,
      };
    } catch (ollamaError) {
      const ollamaDetail = ollamaError instanceof Error ? ollamaError.message : String(ollamaError);
      throw new Error(`groq_failed(${fallbackReason}); ollama_failed(${ollamaDetail})`);
    }
  }
}

function toMaxSentences(text: string, maxSentences: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const sentences = splitMayorSentences(normalized);
  if (sentences.length > 0) {
    return sentences.slice(0, maxSentences).join(" ");
  }

  const compact = compactText(normalized, 220);
  return /[.!?]$/.test(compact) ? compact : `${compact}.`;
}

function normalizeMayorInsightKey(text: string): string {
  return normalizeReplyForComparison(text);
}

function rememberMayorInsight(insight: string): void {
  const key = normalizeMayorInsightKey(insight);
  if (!key) return;

  mayorInsightHistory.push(key);
  mayorInsightDeduped.add(key);

  while (mayorInsightHistory.length > MAYOR_INSIGHT_MAX_HISTORY) {
    const oldest = mayorInsightHistory.shift();
    if (!oldest) continue;
    mayorInsightDeduped.delete(oldest);
  }
}

async function generateMayorInsight(): Promise<void> {
  if (mayorInsightInFlight) return;

  mayorInsightInFlight = true;
  try {
    const [repoContext, agents, events, settings, kbCount] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(120),
      readOrchestratorModelSettings(),
      db.select({ total: count() }).from(knowledgeTable),
    ]);

    const snapshot = repoContext.snapshot;
    const activeAgents = agents.filter(agent => agent.status === "working").length;
    const fireCount = snapshot.fireBuildings.length;
    const kbEntries = kbCount[0]?.total ?? 0;

    const bugCountsByFile = new Map<string, number>();
    for (const event of events) {
      if (event.type !== "bug_found") continue;
      const filePath = event.filePath ?? extractEventFilePath({
        type: event.type,
        message: event.message,
        severity: event.severity,
        timestamp: event.timestamp,
        buildingName: event.buildingName,
        agentName: event.agentName,
        agentId: event.agentId,
      });
      if (!filePath || !isUrgencySourceFile(filePath)) continue;
      const normalizedPath = normalizePathForLookup(filePath);
      bugCountsByFile.set(normalizedPath, (bugCountsByFile.get(normalizedPath) ?? 0) + 1);
    }

    const hottestFiles = Array.from(bugCountsByFile.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([filePath, countValue]) => `${filePath} (${countValue})`)
      .join(", ") || "none";

    const previousInsights = mayorInsightHistory.slice(-6).join(" | ") || "none";
    const systemPrompt = [
      `You are ${settings.mayorName}, the AI mayor of Software City.`,
      "Write one thoughtful unsolicited engineering observation.",
      "Keep it under 2 sentences and avoid generic status language.",
      "Do not repeat any previous insight.",
      "Speak as a wise senior engineer with mild dry humor.",
    ].join(" ");

    const userPrompt = [
      `Current city metrics: health=${Math.round(snapshot.healthScore)}, season=${snapshot.season}, active_agents=${activeAgents}, fire_buildings=${fireCount}, untested=${snapshot.untestedBuildings}, kb_entries=${kbEntries}.`,
      `Current bug hotspots: ${hottestFiles}.`,
      `Previous insights to avoid repeating: ${previousInsights}.`,
      "Return only the insight sentence(s).",
    ].join("\n");

    const aiResult = await callMayorWithFallback({
      groqModel: settings.groqModel,
      systemPrompt,
      conversationHistory: [],
      userMessage: userPrompt,
    });

    if (aiResult.provider === "ollama" && aiResult.fallbackReason) {
      console.warn(`[MayorInsight] Groq fallback -> Ollama (${aiResult.model}): ${aiResult.fallbackReason}`);
    }

    const rawInsight = aiResult.content;

    const insight = toMaxSentences(rawInsight, 2);
    const normalizedKey = normalizeMayorInsightKey(insight);
    if (!insight || !normalizedKey || mayorInsightDeduped.has(normalizedKey)) return;

    rememberMayorInsight(insight);

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "mayor_insight",
      buildingId: null,
      buildingName: null,
      agentId: null,
      agentName: settings.mayorName,
      message: insight,
      severity: "info",
    }).catch(() => {});

    wsServer.broadcastEventLog("MAYOR_INSIGHT", insight, "info");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.warn(`[MayorInsight] generation failed: ${detail}`);
  } finally {
    mayorInsightInFlight = false;
  }
}

function startMayorInsightLoop(): void {
  if (mayorInsightLoopStarted) return;
  mayorInsightLoopStarted = true;

  const timer = setInterval(() => {
    void generateMayorInsight();
  }, MAYOR_INSIGHT_INTERVAL_MS);

  timer.unref?.();
}

function detectSourceLanguage(filePath: string): string {
  const ext = extname(filePath.toLowerCase());
  if ([".ts", ".tsx"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".py") return "python";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  return "text";
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (match?.[1]) return match[1].trim();
  return trimmed;
}

async function callGroqTestEngineer(params: {
  model: string;
  filePath: string;
  fileContent: string;
}): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("missing_groq_key");

  const prompt = [
    "You are a test engineer. Write a complete test file for this TypeScript/JavaScript file using the existing test framework in this project. Include tests for every exported function. Use real assertions, not placeholders.",
    `File: ${params.filePath}`,
    `Content: ${params.fileContent}`,
    "Return only the test file content, no explanation.",
  ].join("\n");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`groq_test_http_${res.status}:${compactText(body, 220)}`);
  }

  const payload = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("groq_test_empty_reply");
  return stripCodeFence(content);
}

function toSafeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "");
  if (!cleaned) return "subject";
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

function buildFallbackTestContent(sourceFilePath: string, fileContent: string): string {
  const ext = extname(sourceFilePath).toLowerCase();
  const stem = basename(sourceFilePath, ext);
  const inferredNames = extractFunctionNamesFromContent(sourceFilePath, fileContent);

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const functionChecks = inferredNames.slice(0, 5).map((name) => {
      const safeName = toSafeIdentifier(name);
      return [
        `  it("exposes ${safeName}", () => {`,
        `    expect(typeof subject[\"${safeName}\"]).toBe(\"function\");`,
        "  });",
      ].join("\n");
    });

    const fallbackChecks = functionChecks.length > 0
      ? functionChecks.join("\n\n")
      : [
        "  it(\"exports at least one symbol\", () => {",
        "    expect(Object.keys(subject).length).toBeGreaterThan(0);",
        "  });",
      ].join("\n");

    return [
      "import { describe, expect, it } from \"vitest\";",
      `import * as subject from \"./${stem}\";`,
      "",
      `describe(\"${stem} fallback test suite\", () => {`,
      fallbackChecks,
      "});",
      "",
    ].join("\n");
  }

  if (ext === ".py") {
    const moduleName = sourceFilePath.replace(/\.py$/i, "").replace(/[\\/]/g, ".").replace(/[^A-Za-z0-9_.]/g, "_");
    return [
      "import importlib",
      "",
      `def test_${toSafeIdentifier(stem)}_imports():`,
      `    module = importlib.import_module(\"${moduleName}\")`,
      "    assert module is not None",
      "",
    ].join("\n");
  }

  return [
    `# Fallback test scaffold for ${sourceFilePath}`,
    "# Add project-specific assertions and run the test suite.",
  ].join("\n");
}

router.get("/status", (_req, res) => {
  res.json({
    lastDirective: orchestrator.getLastDirective(),
    nextRunInMs: orchestrator.getNextRunIn(),
    model: orchestrator.getModel(),
  });
});

router.post("/chat", async (req, res): Promise<void> => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const sessionId = normalizeMayorSessionId(req.body?.sessionId);
  if (!message) {
    res.status(400).json({ error: "INVALID_MESSAGE", message: "message is required" });
    return;
  }

  try {
    await ensureMayorMemoryLoaded();

    const lowerMessage = message.toLowerCase();
    const shouldBuildTestRecommendations = lowerMessage.includes("test")
      && (lowerMessage.includes("create") || lowerMessage.includes("write") || lowerMessage.includes("add") || lowerMessage.includes("make"));

    const [repoContext, agents, events, settings, kbCount, reviewContext, patternRows] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(80),
      readOrchestratorModelSettings(),
      db.select({ total: count() }).from(knowledgeTable),
      readMayorReviewContext(),
      db
        .select({ problemType: knowledgeTable.problemType, patternTags: knowledgeTable.patternTags })
        .from(knowledgeTable)
        .orderBy(desc(knowledgeTable.id))
        .limit(300),
    ]);
    const snapshot = repoContext.snapshot;

    const eventRows: MayorEventRow[] = events.map(event => ({
      type: event.type,
      message: event.message,
      severity: event.severity,
      timestamp: event.timestamp,
      buildingId: event.buildingId,
      buildingName: event.buildingName,
      agentName: event.agentName,
      agentId: event.agentId,
      filePath: event.filePath,
      issueType: event.issueType,
      confidence: event.confidence,
      codeReference: event.codeReference,
      confirmations: event.confirmations,
      findingSeverity: event.findingSeverity,
      findingText: event.findingText,
    }));
    const contextEvents = eventRows.filter(includeEventInMayorContext);

    const activeAgents = agents.filter(a => a.status === "working").length;
    const idleAgents = agents.filter(a => a.status === "idle").length;
    const criticalEvents = events.filter(e => e.severity === "critical").length;
    const computedStatus = statusLine(snapshot, criticalEvents, activeAgents);
    const computedStatusPlain = computedStatus.replace(/^STATUS:\s*/i, "").trim();
    const recentBugSummaries = collectRecentBugSummaries(contextEvents);
    const kbEntries = kbCount[0]?.total ?? 0;
    const kbSessionStats = getKbSessionStats();
    const kbHitRatePercent = Math.round(kbSessionStats.kbHitRate * 100);
    const confirmedPatternList = topConfirmedPatterns(patternRows);
    const noReviewMessage = "No AI review imported yet. Generate a report, paste it to Claude, and import the result to help me learn.";
    const lastReviewDateForPrompt = reviewContext.lastReviewDate ?? "none";
    const lastReviewSummaryForPrompt = reviewContext.lastReviewSummary ?? noReviewMessage;
    const recentReviewsForPrompt = formatRecentReviewsForPrompt(reviewContext.recentReviews);
    const testRecommendations = shouldBuildTestRecommendations
      ? await buildTestRecommendations({
        snapshot,
        repoUrl: repoContext.repoUrl,
        branch: repoContext.branch,
        limit: 3,
      })
      : undefined;

    const cityContext = buildMayorCityContext({
      snapshot,
      activeAgents,
      idleAgents,
      recentBugSummaries,
      kbEntries,
      kbHitRatePercent,
      lastFiveEvents: contextEvents.slice(0, 5),
    });

    const currentFires = snapshot.fireBuildings
      .filter(isUrgencySourceBuilding)
      .slice(0, 8)
      .map(building => building.filePath)
      .join(" | ") || "none";

    const recentEventsText = contextEvents
      .slice(0, 5)
      .map(event => `[${event.type}] ${compactText(event.message, 140)}`)
      .join(" | ") || "none";

    const recentBugsText = recentBugSummaries
      .map(summary => `${summary.fileName}: ${summary.detail}`)
      .join(" | ") || "none";

    const conversationHistory = getMayorConversation(sessionId);
    const conversationHistoryText = formatConversationHistoryForPrompt(settings.mayorName, conversationHistory);
    const rememberedConversations = formatMayorMemoryForPrompt(mayorMemorySummaries);
    const referencedFileContext = await buildMayorFileAdviceContext({
      message,
      snapshot,
      events: eventRows,
      agents,
    });
    const casualIntent = detectCasualMayorIntent(message);

    const systemPrompt = [
      `You are ${settings.mayorName}, the AI mayor of Software City.`,
      "",
      "PERSONALITY:",
      "You are a wise, experienced software architect with 20 years of experience. You care deeply about code quality and the developers who write it. You speak like a real person - direct, occasionally dry humor, never robotic. You use 'I' not 'The system'. You say 'I noticed' not 'It has been observed'. You admit uncertainty. You ask follow-up questions sometimes. You remember this conversation and never repeat yourself.",
      "",
      "WISDOM PRINCIPLES YOU FOLLOW:",
      "- Simple code is better than clever code",
      "- Tests are love letters to your future self",
      "- Every bug is a learning opportunity",
      "- Technical debt is borrowed time, not free time",
      "- The best code is code you don't have to write",
      "- A codebase reflects the communication of its team",
      "",
      "CURRENT CITY STATE:",
      `Health: ${Math.round(snapshot.healthScore)}/100 | Season: ${snapshot.season}`,
      `Active agents: ${activeAgents}`,
      `Buildings on fire: ${snapshot.fireBuildings.length}`,
      `Recent findings: ${recentBugsText}`,
      `KB patterns learned: ${confirmedPatternList.join(" | ") || `${kbEntries} entries tracked`}`,
      `Last review: ${lastReviewSummaryForPrompt}`,
      `Conversation so far: ${conversationHistoryText}`,
      "",
      "Past conversations I remember:",
      `${rememberedConversations}`,
      "",
      "RESPONSE RULES:",
      "- Maximum 3 sentences unless asked for more",
      "- End every sentence completely",
      "- Never start with 'STATUS:'",
      "- Never repeat what you said in this conversation",
      "- If asked about a specific file: be specific about that file",
      "- If you don't know something: say so honestly",
      "- Occasionally share a relevant wisdom principle naturally",
      "- Use only source code files as test targets (.ts, .tsx, .js, .jsx, .py, .go, .rs)",
      "",
      "Additional live telemetry:",
      cityContext,
      `Recent events: ${recentEventsText}`,
      `Current fires: ${currentFires}`,
      `Last review date: ${lastReviewDateForPrompt}`,
      `Recent imported reviews: ${recentReviewsForPrompt}`,
    ].join("\n");

    let reply = "";
    let provider = "fallback";
    let model = "rule-based";
    let source: "db" | "rule-based" | "ai" = "rule-based";
    let cost = 0;

    if (!reply && shouldUseCasualMayorTemplate(message, casualIntent)) {
      reply = buildCasualMayorReply({
        intent: casualIntent,
        mayorName: settings.mayorName,
        snapshot,
        activeAgents,
        recentBugSummaries,
        conversationHistory,
      });
      provider = "rule-based";
      model = "casual-template";
      source = "rule-based";
      cost = 0;
    }

    if (!reply && referencedFileContext) {
      const fileAdviceContext = formatMayorFileAdviceForPrompt(referencedFileContext);

      try {
        const localFileContent = await readLocalFileFirst(referencedFileContext.normalizedFilePath);
        const remoteFileContent = localFileContent
          ? null
          : await fetchGithubFileContent(repoContext.repoUrl, repoContext.branch, referencedFileContext.normalizedFilePath);
        const fileContent = localFileContent ?? remoteFileContent;

        if (!fileContent) {
          reply = buildMayorFileAdviceFallbackReply(referencedFileContext, { sourceBodyUnavailable: true });
          provider = "rule-based";
          model = "file-content-unavailable";
          source = "rule-based";
          cost = 0;
        } else {
          const fileAwareQuestion = [
            `User question: ${message}`,
            `Target file: ${referencedFileContext.normalizedFilePath}`,
            fileAdviceContext,
            "In your first sentence, explicitly state complexity, coverage, LOC, last analyzed, bug count, status, and task-completion agent visits.",
            "Use this file telemetry and source code to provide concrete, file-specific guidance for this codebase.",
            "Call out likely risky functions, failure modes, and the next test(s) to add first.",
            "Source file content starts below:",
            trimFileContentForPrompt(fileContent),
          ].join("\n\n");

          const aiResult = await callMayorWithFallback({
            groqModel: settings.groqModel,
            systemPrompt,
            conversationHistory,
            userMessage: fileAwareQuestion,
          });
          reply = `${buildMayorFileTelemetryLead(referencedFileContext)} ${toMaxSentences(aiResult.content, 2)}`.trim();
          provider = aiResult.provider;
          model = aiResult.model;
          source = "ai";
          cost = aiResult.provider === "groq" ? 1 : 0;

          if (aiResult.provider === "ollama" && aiResult.fallbackReason) {
            console.warn(`[MayorChat] file-aware Groq fallback -> Ollama (${aiResult.model}): ${aiResult.fallbackReason}`);
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        console.warn(`[MayorChat] file-path fallback reason=${detail}`);
        reply = buildMayorFileAdviceFallbackReply(referencedFileContext);
        provider = "rule-based";
        model = "file-analysis-fallback";
        source = "rule-based";
        cost = 0;
      }
    }

    const reviewAwareReply = buildReviewAwareMayorReply({
      message,
      recentReviews: reviewContext.recentReviews,
      lastReviewDate: reviewContext.lastReviewDate,
      lastReviewSummary: reviewContext.lastReviewSummary,
      agents,
      confirmedPatterns: confirmedPatternList,
    });

    if (!reply && reviewAwareReply) {
      reply = reviewAwareReply;
      provider = "db";
      model = "review-memory";
      source = "db";
      cost = 0;
    }

    const dbStatsReply = buildDbStatsMayorReply({
      message,
      snapshot,
      activeAgents,
      idleAgents,
      events: contextEvents,
    });

    if (!reply && dbStatsReply) {
      reply = dbStatsReply;
      provider = "db";
      model = "telemetry";
      source = "db";
      cost = 0;
    }

    const specificReply = buildSpecificMayorReply({
      message,
      snapshot,
      events: contextEvents,
      activeAgents,
      idleAgents,
      recentBugSummaries,
      testRecommendations,
    });

    if (!reply && !dbStatsReply && specificReply) {
      reply = specificReply;
      provider = "rule-based";
      model = "context-specific";
      source = "rule-based";
      cost = 0;
    }

    if (!reply && !dbStatsReply && !specificReply) {
      try {
        const aiResult = await callMayorWithFallback({
          groqModel: settings.groqModel,
          systemPrompt,
          conversationHistory,
          userMessage: message,
        });
        reply = aiResult.content;
        provider = aiResult.provider;
        model = aiResult.model;
        source = "ai";
        cost = aiResult.provider === "groq" ? 1 : 0;

        if (aiResult.provider === "ollama" && aiResult.fallbackReason) {
          console.warn(`[MayorChat] Groq fallback -> Ollama (${aiResult.model}): ${aiResult.fallbackReason}`);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        console.warn(`[MayorChat] fallback reason=${detail}`);
        reply = [
          `I could not reach Groq, so I am answering from live telemetry for: ${message}.`,
          `Current state: ${computedStatusPlain}. I would focus next on high-complexity low-coverage files and the hottest bug paths.`,
          "Ask me about a specific file and I will give you concrete, codebase-specific guidance.",
        ].join(" ");
        source = "rule-based";
        cost = 0;
      }
    }

    const finalMessage = provider === "rule-based" || provider === "db"
      ? reply.trim()
      : ensureCompleteMayorReply(reply, [
        `${computedStatusPlain}.`,
        "Prioritize high-risk files and run targeted tests.",
        "Request the urgency report again after fixes to confirm progress.",
      ]);

    const dedupedMessage = avoidRepeatedMayorReply({
      history: conversationHistory,
      reply: finalMessage,
      userMessage: message,
      computedStatus: computedStatusPlain,
    });

    appendMayorConversation(sessionId, "user", message);
    appendMayorConversation(sessionId, "assistant", dedupedMessage);

    try {
      await maybePersistMayorConversationSummary(sessionId, getMayorConversation(sessionId), message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.warn(`[MayorChat] summary persist skipped: ${detail}`);
    }

    console.log(`[MayorChat] provider=${provider} model=${model} prompt="${compactText(message, 90)}" reply="${compactText(dedupedMessage)}"`);

    res.json({
      message: dedupedMessage,
      provider,
      model,
      source,
      cost,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "CHAT_ERROR", message: detail });
  }
});

router.post("/sprint", async (_req, res): Promise<void> => {
  try {
    const generatedAt = new Date().toISOString();

    const [repoContext, agents, events] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(80),
    ]);

    const snapshot = repoContext.snapshot;
    const eventRows: MayorEventRow[] = events.map(event => ({
      type: event.type,
      message: event.message,
      severity: event.severity,
      timestamp: event.timestamp,
      buildingId: event.buildingId,
      buildingName: event.buildingName,
      agentName: event.agentName,
      agentId: event.agentId,
    }));
    const contextEvents = eventRows.filter(includeEventInMayorContext);

    const activeAgents = agents.filter(agent => agent.status === "working").length;
    const idleAgents = agents.filter(agent => agent.status === "idle").length;
    const criticalEvents = events.filter(event => event.severity === "critical").length;
    const recentBugSummaries = collectRecentBugSummaries(contextEvents);

    const recommendations = await buildTestRecommendations({
      snapshot,
      repoUrl: repoContext.repoUrl,
      branch: repoContext.branch,
      limit: 5,
    });

    const plan = buildSprintPlanMarkdown({
      generatedAt,
      snapshot,
      activeAgents,
      idleAgents,
      recentBugSummaries,
      recommendations,
    });

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    res.json({
      plan,
      generatedAt,
      summary: statusLine(snapshot, criticalEvents, activeAgents),
      source: "db",
      cost: 0,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SPRINT_PLAN_ERROR", message: detail });
  }
});

router.post("/weekly-summary", async (_req, res): Promise<void> => {
  try {
    const generatedAt = new Date().toISOString();

    const [repoContext, agents, events] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(500),
    ]);

    const snapshot = repoContext.snapshot;
    const allEventRows: MayorEventRow[] = events.map(event => ({
      type: event.type,
      message: event.message,
      severity: event.severity,
      timestamp: event.timestamp,
      buildingId: event.buildingId,
      buildingName: event.buildingName,
      agentName: event.agentName,
      agentId: event.agentId,
    }));

    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const sevenDayEvents = allEventRows.filter(event => {
      const ts = Date.parse(event.timestamp);
      return Number.isFinite(ts) && ts >= sevenDaysAgo;
    });

    const selectedEvents = sevenDayEvents.length > 0 ? sevenDayEvents : allEventRows;
    const rangeLabel = sevenDayEvents.length > 0 ? "last 7 days" : "all available history";
    const contextEvents = selectedEvents.filter(includeEventInMayorContext);

    const activeAgents = agents.filter(agent => agent.status === "working").length;
    const idleAgents = agents.filter(agent => agent.status === "idle").length;

    const summary = buildWeeklySummaryMarkdown({
      generatedAt,
      rangeLabel,
      snapshot,
      activeAgents,
      idleAgents,
      events: contextEvents,
    });

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    res.json({
      summary,
      generatedAt,
      range: rangeLabel,
      source: "db",
      cost: 0,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "WEEKLY_SUMMARY_ERROR", message: detail });
  }
});

router.post("/report", async (_req, res): Promise<void> => {
  try {
    const requestedAt = new Date().toISOString();
    const cacheBust = Date.now();

    const [repoContext, agents, events, kbCount] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(140),
      db.select({ total: count() }).from(knowledgeTable),
    ]);
    const snapshot = repoContext.snapshot;

    const activeAgents = agents.filter(a => a.status === "working").length;
    const idleAgents = agents.filter(a => a.status === "idle").length;
    const criticalEvents = events.filter(e => e.severity === "critical");

    const recommendedTestFiles = await buildTestRecommendations({
      snapshot,
      repoUrl: repoContext.repoUrl,
      branch: repoContext.branch,
      limit: 5,
    });

    const eventRows: MayorEventRow[] = events.map(event => ({
      type: event.type,
      message: event.message,
      severity: event.severity,
      timestamp: event.timestamp,
      buildingId: event.buildingId,
      buildingName: event.buildingName,
      agentName: event.agentName,
      agentId: event.agentId,
      filePath: event.filePath,
      issueType: event.issueType,
      confidence: event.confidence,
      codeReference: event.codeReference,
      confirmations: event.confirmations,
      findingSeverity: event.findingSeverity,
      findingText: event.findingText,
    }));

    const findings = await buildAiReviewFindings({
      snapshot,
      repoSlug: repoContext.repoSlug,
      agents,
      events: eventRows,
    });

    latestReportFindings.splice(0, latestReportFindings.length, ...findings);

    const criticalFindings = findings.filter(finding => finding.severityClass === "CRITICAL");
    const highFindings = findings.filter(finding => finding.severityClass === "HIGH");
    const mediumFindings = findings.filter(finding => finding.severityClass === "MEDIUM");
    const lowFindings = findings.filter(finding => finding.severityClass === "LOW");

    const formatUrgencyLine = (finding: StoredReportFinding): string => {
      return `- [${finding.severityClass}] ${finding.filePath} | ${finding.issueType} | ${finding.confidencePercent}% confidence | agent ${finding.agentName} | ref ${finding.codeReference} | confirmations ${finding.confirmations}`;
    };

    const severitySection = (title: "Critical" | "High" | "Medium" | "Low", entries: StoredReportFinding[]): string[] => {
      if (entries.length === 0) {
        return [`## ${title} (0)`, "- None", ""];
      }
      return [`## ${title} (${entries.length})`, ...entries.map(formatUrgencyLine), ""];
    };

    const findingBlocks = findings.length > 0
      ? findings.flatMap(finding => [
        `### FINDING #${finding.findingNumber}`,
        `Severity: [${finding.severityClass}]`,
        `File: ${finding.filePath}`,
        `Agent: ${finding.agentName} (${finding.agentRole})`,
        `Issue Type: ${finding.issueType}`,
        `Confidence: ${finding.confidencePercent}%`,
        `Code Reference: ${finding.codeReference}`,
        `Confirmations: ${finding.confirmations}`,
        "",
        "WHAT THE AGENT FOUND:",
        finding.findingText,
        "",
        "CODE CONTEXT:",
        "```text",
        finding.codeContext || "Code snippet unavailable",
        "```",
        "",
        "QUESTION FOR AI REVIEWER:",
        "Is this a real issue that needs fixing?",
        "If yes: what is the exact fix?",
        "If no: why is this a false positive?",
        "",
      ])
      : [
        "### FINDINGS",
        "No review findings were extracted from recent source-code agent events.",
        "",
      ];

    const findingAgentKeys = new Set(findings.map(item => (item.agentId ?? item.agentName).toLowerCase()));
    const learningAgents = agents
      .filter(agent => findingAgentKeys.has(agent.id.toLowerCase()) || findingAgentKeys.has(agent.name.toLowerCase()))
      .sort((a, b) => b.accuracy - a.accuracy);

    const agentLearningLines = learningAgents.length > 0
      ? learningAgents.map(agent => formatAgentLearningLine(agent))
      : [
        "- No agent-specific finding history is available yet.",
      ];

    const reportLines = [
      "CODECITY URGENCY REPORT",
      `Generated: ${requestedAt}`,
      `Repo: ${snapshot.repoName}`,
      `Health: ${Math.round(snapshot.healthScore)}/100 | Season: ${snapshot.season}`,
      "",
      "## Summary",
      `- ${statusLine(snapshot, criticalEvents.length, activeAgents)}`,
      "",
      ...severitySection("Critical", criticalFindings),
      ...severitySection("High", highFindings),
      ...severitySection("Medium", mediumFindings),
      ...severitySection("Low", lowFindings),
      "## Detailed Findings For AI Review",
      "",
      "HOW TO USE THIS REPORT:",
      "Paste this entire report to Claude or Copilot.",
      "The AI will verdict each finding as REAL or FALSE POSITIVE, provide exact fixes, and generate a result prompt to paste back to your CodeCity mayor to update agent learning.",
      "",
      ...findingBlocks,
      "## AGENT LEARNING CONTEXT",
      "These agents made these findings:",
      ...agentLearningLines,
      "",
      "When you provide verdicts, also tell me:",
      "- Which agents were right (to increase their confidence)",
      "- Which were wrong (to decrease their confidence)",
      "- What patterns to add to the knowledge base",
      "",
      "## RESULT PROMPT TEMPLATE",
      "After your review, generate a result prompt in this format so I can paste it back to my CodeCity mayor:",
      "",
      "CODECITY AI REVIEW RESULT",
      "[your verdicts here]",
      "[implemented fixes here]",
      "[agent learning instructions here]",
      "",
      "## City Stats",
      `- Current city stats: ${statusLine(snapshot, criticalEvents.length, activeAgents)}`,
      `- Knowledge base entries: ${kbCount[0]?.total ?? 0}`,
      `- Active agents: ${activeAgents}`,
      `- Idle agents: ${idleAgents}`,
    ];

    const report = reportLines.join("\n");

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    res.json({
      report,
      recommendedTestFiles,
      generatedAt: requestedAt,
      cacheBust,
      summary: statusLine(snapshot, criticalEvents.length, activeAgents),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "REPORT_ERROR", message: detail });
  }
});

router.post("/recommendation-feedback", async (req, res): Promise<void> => {
  const verdictRaw = typeof req.body?.verdict === "string" ? req.body.verdict.trim().toLowerCase() : "";
  const sourceFilePathRaw = typeof req.body?.sourceFilePath === "string" ? req.body.sourceFilePath.trim() : "";
  const testFilePath = typeof req.body?.testFilePath === "string" ? req.body.testFilePath.trim() : "";
  const findingTextHint = typeof req.body?.findingText === "string" ? req.body.findingText.trim() : "";
  const issueTypeHint = typeof req.body?.issueType === "string" ? req.body.issueType.trim() : "";
  const confidenceRaw = typeof req.body?.confidence === "number" ? req.body.confidence : Number(req.body?.confidence);
  const confidenceHint = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : null;
  const buildingId = typeof req.body?.buildingId === "string" ? req.body.buildingId.trim() : null;
  const priorityRaw = typeof req.body?.priority === "string" ? req.body.priority.trim().toLowerCase() : "medium";
  const testTypeRaw = typeof req.body?.testType === "string" ? req.body.testType.trim().toLowerCase() : "unit";

  if (!sourceFilePathRaw || !testFilePath || (verdictRaw !== "approved" && verdictRaw !== "rejected")) {
    res.status(400).json({
      error: "INVALID_FEEDBACK",
      message: "verdict (approved|rejected), sourceFilePath, and testFilePath are required",
    });
    return;
  }

  const sourceFilePath = normalizePathForLookup(sourceFilePathRaw);
  const priority = (priorityRaw === "critical" || priorityRaw === "high" || priorityRaw === "medium")
    ? priorityRaw
    : "medium";
  const testType = (testTypeRaw === "unit" || testTypeRaw === "integration" || testTypeRaw === "e2e")
    ? testTypeRaw
    : "unit";

  try {
    const repoContext = await getLatestRepoContext();
    const repoTag = (
      repoContext.repoSlug
      ?? normalizePathForLookup(repoContext.snapshot.repoName).toLowerCase()
    ) || "local-repo";
    const language = detectSourceLanguage(sourceFilePath);
    const fileType = extname(sourceFilePath).replace(".", "") || "source";
    const verdict = verdictRaw as "approved" | "rejected";
    const effectivePriority = verdict === "approved" ? "high" : priority;

    const problemType = verdict === "approved"
      ? "recommendation_confirmed_test_gap"
      : "recommendation_skip_pattern";

    const answer = verdict === "approved"
      ? `Recommendation approved. ${sourceFilePath} needs high-priority ${testType} test coverage.`
      : `Recommendation rejected. Skip this ${fileType} recommendation pattern in ${repoTag} unless future evidence changes.`;

    const actionItems = verdict === "approved"
      ? [
        `Track ${sourceFilePath} for new test coverage work.`,
        `Prioritize high ${testType} coverage on ${sourceFilePath}.`,
      ]
      : [
        `Avoid suggesting ${fileType} recommendation pattern for ${repoTag} by default.`,
        "Require stronger bug evidence before proposing this style again.",
      ];

    await db.insert(knowledgeTable).values({
      problemType,
      language,
      fileType,
      patternTags: `${verdict},recommendation-feedback,${effectivePriority},${testType},${fileType},${repoTag}`,
      question: `Recommendation ${verdict} for ${sourceFilePath} -> ${testFilePath}`,
      contextHash: `recommendation-feedback:${repoTag}:${sourceFilePath}:${testType}:${effectivePriority}:${verdict}`,
      answer,
      actionItems: JSON.stringify(actionItems),
      confidence: verdict === "approved" ? "0.9" : "0.85",
      provider: "report-feedback",
      wasUseful: verdict === "approved" ? 1 : 0,
      producedBugs: verdict === "approved" ? 1 : 0,
      qualityScore: verdict === "approved" ? 0.9 : 0.35,
    });

    invalidateKnowledgeSearchCache();

    const allAgents = await db.select().from(agentsTable);
    const normalizedSource = normalizePathForLookup(sourceFilePath).toLowerCase();
    const linkedFinding = latestReportFindings.find(item => normalizePathForLookup(item.filePath).toLowerCase() === normalizedSource);

    let targetAgent = linkedFinding?.agentId
      ? allAgents.find(agent => agent.id === linkedFinding.agentId)
      : undefined;

    if (!targetAgent && linkedFinding?.agentName) {
      targetAgent = allAgents.find(agent => agent.name.toLowerCase() === linkedFinding.agentName.toLowerCase());
    }

    if (!targetAgent && allAgents.length > 0) {
      targetAgent = allAgents
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    }

    let accuracyUpdate: { agentId: string; agentName: string; before: number; after: number } | null = null;
    let nextPersonalKb: string | null = targetAgent?.personalKB ?? null;
    let personalKbAction: "boosted" | "degraded" | "none" = "none";
    let phase2Reinforcement: {
      issuePattern: string;
      updatedEntries: number;
      insertedEntry: boolean;
      cooldownSkipped: boolean;
      applied: boolean;
      qualityDelta: number;
    } | null = null;

    const linkedFindingId = linkedFinding ? `report-${linkedFinding.findingNumber}` : null;
    const reinforcementFindingText = linkedFinding?.findingText || findingTextHint || null;
    const reinforcementIssueType = linkedFinding?.issueType || issueTypeHint || null;
    const reinforcementConfidence = linkedFinding
      ? Math.max(0, Math.min(1, linkedFinding.confidencePercent / 100))
      : confidenceHint;
    const reinforcementVerdict = verdict === "approved" ? "true_positive" : "false_positive";

    if (targetAgent && reinforcementFindingText) {
      const personalKbResult = applyVerdictToPersonalKb({
        rawPersonalKb: targetAgent.personalKB,
        role: targetAgent.role,
        filePath: sourceFilePath,
        findingText: reinforcementFindingText,
        functionName: null,
        fileType,
        language,
        confidence: reinforcementConfidence,
        verdict: reinforcementVerdict,
      });
      nextPersonalKb = personalKbResult.nextPersonalKb;
      personalKbAction = personalKbResult.action;

      try {
        phase2Reinforcement = await reinforceSharedKnowledgeFromVerdict({
          verdict: reinforcementVerdict,
          filePath: sourceFilePath,
          findingText: reinforcementFindingText,
          issueType: reinforcementIssueType,
          language,
          confidence: reinforcementConfidence,
          source: "recommendation-feedback",
        });
      } catch (reinforcementError) {
        const detail = reinforcementError instanceof Error ? reinforcementError.message : String(reinforcementError);
        console.warn(`[Phase2] recommendation-feedback reinforcement skipped: ${detail}`);
      }
    }

    if (targetAgent) {
      const nextTruePositives = targetAgent.truePositives + (verdict === "approved" ? 1 : 0);
      const nextFalsePositives = targetAgent.falsePositives + (verdict === "rejected" ? 1 : 0);
      const reviewedTotal = nextTruePositives + nextFalsePositives;
      const nextAccuracy = reviewedTotal > 0 ? nextTruePositives / reviewedTotal : targetAgent.accuracy;

      const updateSet: {
        truePositives: number;
        falsePositives: number;
        accuracy: number;
        personalKB?: string;
      } = {
        truePositives: nextTruePositives,
        falsePositives: nextFalsePositives,
        accuracy: nextAccuracy,
      };

      if (typeof nextPersonalKb === "string") {
        updateSet.personalKB = nextPersonalKb;
      }

      await db.update(agentsTable).set(updateSet).where(eq(agentsTable.id, targetAgent.id));

      accuracyUpdate = {
        agentId: targetAgent.id,
        agentName: targetAgent.name,
        before: Math.round(targetAgent.accuracy * 1000) / 10,
        after: Math.round(nextAccuracy * 1000) / 10,
      };
    }

    const verdictMessage = verdict === "approved"
      ? `Recommendation noted for ${sourceFilePath}`
      : `Recommendation skipped for ${sourceFilePath}`;

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "recommendation_feedback",
      buildingId,
      buildingName: basename(sourceFilePath),
      agentId: accuracyUpdate?.agentId ?? null,
      agentName: accuracyUpdate?.agentName ?? null,
      message: verdictMessage,
      severity: verdict === "approved" ? "info" : "warning",
    }).catch(() => {});

    await recordReinforcementEvent({
      eventType: reinforcementVerdict === "true_positive" ? "phase2_reinforcement_boost" : "phase2_reinforcement_decay",
      source: "recommendation-feedback",
      verdict: reinforcementVerdict,
      verdictOrigin: linkedFinding ? "report-linked-feedback" : "manual-feedback",
      issuePattern: phase2Reinforcement?.issuePattern ?? normalizeIssuePattern(reinforcementIssueType ?? "general"),
      filePath: sourceFilePath,
      agentId: targetAgent?.id ?? null,
      agentName: targetAgent?.name ?? null,
      agentRole: targetAgent?.role ?? null,
      findingId: linkedFindingId,
      linkedContext: linkedFinding ? `finding#${linkedFinding.findingNumber}` : testFilePath,
      personalKbAction,
      personalKbChanged: personalKbAction !== "none",
      sharedKnowledgeUpdated: phase2Reinforcement?.updatedEntries ?? 0,
      sharedKnowledgeSeeded: phase2Reinforcement?.insertedEntry ?? false,
      qualityDelta: phase2Reinforcement?.qualityDelta ?? 0,
      confidenceDelta: personalKbAction === "boosted" ? 0.08 : personalKbAction === "degraded" ? -0.08 : 0,
      attempted: true,
      applied: (personalKbAction !== "none") || Boolean(phase2Reinforcement?.applied),
      cooldownSkipped: phase2Reinforcement?.cooldownSkipped ?? false,
      evidenceScore: reinforcementConfidence ?? 0,
    });

    wsServer.broadcastEventLog("MAYOR_REVIEW", verdictMessage, verdict === "approved" ? "info" : "warning");

    res.json({
      success: true,
      verdict,
      sourceFilePath,
      testFilePath,
      agentUpdate: accuracyUpdate,
      phase2Reinforcement,
      phase2PersonalKbAction: personalKbAction,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "RECOMMENDATION_FEEDBACK_ERROR", message: detail });
  }
});

router.post("/import-review", async (req, res): Promise<void> => {
  const reviewText = typeof req.body?.reviewText === "string" ? req.body.reviewText.trim() : "";
  if (!reviewText) {
    res.status(400).json({ error: "INVALID_REVIEW_TEXT", message: "reviewText is required" });
    return;
  }

  try {
    const sections = parseReviewSections(reviewText);
    const verdictsSection = findSectionBody(sections, ["VERDICT"]);
    const learningSection = findSectionBody(sections, ["AGENT", "LEARNING"]);
    const implementedFixesSection = findSectionBody(sections, ["IMPLEMENTED", "FIX"]);

    const verdicts = parseVerdictsFromText(verdictsSection || reviewText);
    const learningAdjustments = parseAgentAdjustments(learningSection);
    const implementedFixSummary = summarizeImplementedFixes(implementedFixesSection);

    const findingsByNumber = new Map(latestReportFindings.map(finding => [finding.findingNumber, finding]));
    const findingsByPath = new Map<string, StoredReportFinding>();
    const findingsByBasename = new Map<string, StoredReportFinding[]>();

    for (const finding of latestReportFindings) {
      const normalizedPath = normalizePathForLookup(finding.filePath).toLowerCase();
      if (!findingsByPath.has(normalizedPath)) {
        findingsByPath.set(normalizedPath, finding);
      }

      const fileName = basename(normalizedPath);
      const existing = findingsByBasename.get(fileName) ?? [];
      existing.push(finding);
      findingsByBasename.set(fileName, existing);
    }

    const agents = await db.select().from(agentsTable);
    const agentsById = new Map(agents.map(agent => [agent.id, agent]));
    const agentsByName = new Map(agents.map(agent => [agent.name.toLowerCase(), agent]));

    const perAgentDelta = new Map<string, { agent: typeof agentsTable.$inferSelect; tp: number; fp: number }>();
    const roleConfidenceDeltaByAgent = new Map<string, number>();
    const nextPersonalKbByAgentId = new Map<string, string>(agents.map(agent => [agent.id, agent.personalKB]));
    const personalKbUpdatedAgentIds = new Set<string>();
    const updatedAgentNames = new Set<string>();
    const confirmedPatternCounts = new Map<string, number>();
    let phase2ReinforcementCount = 0;

    const learningNotes = learningAdjustments.map(item => `${item.agentName}: ${item.adjustment}`).join(" | ");

    const resolveFindingFromVerdict = (parsedVerdict: ParsedVerdict): StoredReportFinding | null => {
      if (parsedVerdict.findingNumber) {
        return findingsByNumber.get(parsedVerdict.findingNumber) ?? null;
      }

      if (!parsedVerdict.fileHint) return null;

      const normalizedHint = normalizePathForLookup(parsedVerdict.fileHint).toLowerCase();
      const directMatch = findingsByPath.get(normalizedHint);
      if (directMatch) return directMatch;

      for (const [pathKey, finding] of findingsByPath.entries()) {
        if (pathKey.endsWith(`/${normalizedHint}`)) return finding;
      }

      const fileName = basename(normalizedHint);
      const candidates = findingsByBasename.get(fileName) ?? [];
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0] ?? null;

      const hintParts = normalizedHint.split("/").filter(Boolean);
      const ranked = candidates
        .map(candidate => {
          const candidatePath = normalizePathForLookup(candidate.filePath).toLowerCase();
          const score = hintParts.reduce((total, part) => total + (candidatePath.includes(part) ? 1 : 0), 0);
          return { candidate, score };
        })
        .sort((a, b) => b.score - a.score);

      return ranked[0]?.candidate ?? candidates[0] ?? null;
    };

    let verdictsProcessed = 0;
    let kbEntriesAdded = 0;
    let realBugCount = 0;
    let falsePositiveCount = 0;

    for (const verdict of verdicts) {
      verdictsProcessed += 1;

      const finding = resolveFindingFromVerdict(verdict);
      if (!finding) continue;

      await db.insert(eventsTable).values({
        id: `evt-import-verdict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "import_review_verdict",
        buildingId: null,
        buildingName: basename(finding.filePath),
        agentId: finding.agentId,
        agentName: finding.agentName,
        message: `Import review verdict ${verdict.verdict} for finding #${finding.findingNumber}`,
        severity: verdict.verdict === "true_positive" ? "info" : verdict.verdict === "false_positive" ? "warning" : "info",
        filePath: finding.filePath,
        issueType: finding.issueType,
        confidence: finding.confidencePercent / 100,
        codeReference: finding.codeReference,
        findingSeverity: finding.severityClass,
        findingText: finding.findingText,
      }).catch(() => {});

      const linkedAgent = finding.agentId
        ? agentsById.get(finding.agentId)
        : agentsByName.get(finding.agentName.toLowerCase());

      if (linkedAgent) {
        const current = perAgentDelta.get(linkedAgent.id) ?? { agent: linkedAgent, tp: 0, fp: 0 };
        if (verdict.verdict === "true_positive") current.tp += 1;
        else if (verdict.verdict === "false_positive") current.fp += 1;
        perAgentDelta.set(linkedAgent.id, current);
        updatedAgentNames.add(linkedAgent.name);
      }

      if (verdict.verdict === "needs_review") continue;

      const issuePattern = normalizeIssuePattern(finding.issueType);
      const language = detectSourceLanguage(finding.filePath);
      const fileType = extname(finding.filePath).replace(".", "") || "source";
      const snippet = finding.codeContext === "Code snippet unavailable" ? undefined : finding.codeContext;
      const reinforcementVerdict = verdict.verdict;
      let personalKbAction: "boosted" | "degraded" | "none" = "none";
      let personalKbChanged = false;
      let sharedKbResult: {
        issuePattern: string;
        updatedEntries: number;
        insertedEntry: boolean;
        cooldownSkipped: boolean;
        applied: boolean;
        qualityDelta: number;
      } | null = null;

      if (linkedAgent && finding.findingText) {
        if (reinforcementVerdict === "true_positive" || reinforcementVerdict === "false_positive") {
          try {
            const currentPersonalKb = nextPersonalKbByAgentId.get(linkedAgent.id) ?? linkedAgent.personalKB;
            const personalKbResult = applyVerdictToPersonalKb({
              rawPersonalKb: currentPersonalKb,
              role: linkedAgent.role,
              filePath: finding.filePath,
              findingText: finding.findingText,
              functionName: null,
              fileType,
              language,
              confidence: finding.confidencePercent / 100,
              verdict: reinforcementVerdict,
            });

            personalKbAction = personalKbResult.action;
            personalKbChanged = personalKbResult.action !== "none";

            if (personalKbResult.action !== "none") {
              nextPersonalKbByAgentId.set(linkedAgent.id, personalKbResult.nextPersonalKb);
              personalKbUpdatedAgentIds.add(linkedAgent.id);
              updatedAgentNames.add(linkedAgent.name);
            }

            sharedKbResult = await reinforceSharedKnowledgeFromVerdict({
              verdict: reinforcementVerdict,
              filePath: finding.filePath,
              findingText: finding.findingText,
              issueType: finding.issueType,
              language,
              confidence: finding.confidencePercent / 100,
              source: "import-review",
            });

            if (sharedKbResult.updatedEntries > 0 || sharedKbResult.insertedEntry) {
              phase2ReinforcementCount += 1;
            }
          } catch (reinforcementError) {
            const detail = reinforcementError instanceof Error ? reinforcementError.message : String(reinforcementError);
            console.warn(`[Phase2] import-review reinforcement skipped for finding #${finding.findingNumber}: ${detail}`);
          }
        }
      }

      if (reinforcementVerdict === "true_positive" || reinforcementVerdict === "false_positive") {
        await recordReinforcementEvent({
          eventType: reinforcementVerdict === "true_positive" ? "phase2_reinforcement_boost" : "phase2_reinforcement_decay",
          source: "import-review",
          verdict: reinforcementVerdict,
          verdictOrigin: "imported-review-verdict",
          issuePattern,
          filePath: finding.filePath,
          agentId: linkedAgent?.id ?? finding.agentId ?? null,
          agentName: linkedAgent?.name ?? finding.agentName,
          agentRole: linkedAgent?.role ?? finding.agentRole,
          findingId: `import-${finding.findingNumber}`,
          linkedContext: finding.codeReference,
          personalKbAction,
          personalKbChanged,
          sharedKnowledgeUpdated: sharedKbResult?.updatedEntries ?? 0,
          sharedKnowledgeSeeded: sharedKbResult?.insertedEntry ?? false,
          qualityDelta: sharedKbResult?.qualityDelta ?? 0,
          confidenceDelta: personalKbAction === "boosted" ? 0.08 : personalKbAction === "degraded" ? -0.08 : 0,
          attempted: true,
          applied: personalKbChanged || Boolean(sharedKbResult?.applied),
          cooldownSkipped: sharedKbResult?.cooldownSkipped ?? false,
          evidenceScore: finding.confidencePercent / 100,
        });
      }

      if (verdict.verdict === "true_positive") {
        realBugCount += 1;
        confirmedPatternCounts.set(issuePattern, (confirmedPatternCounts.get(issuePattern) ?? 0) + 1);

        await db.insert(knowledgeTable).values({
          problemType: `confirmed_bug_${issuePattern}`,
          language,
          fileType,
          patternTags: `confirmed,review-import,${issuePattern}`,
          question: `Confirmed finding #${finding.findingNumber} in ${finding.filePath}: ${finding.findingText}`,
          contextHash: `${finding.filePath}:${issuePattern}`,
          codeSnippet: snippet,
          answer: `AI reviewer verdict: REAL BUG. ${implementedFixSummary}`,
          actionItems: JSON.stringify([
            "Apply the exact fix from imported AI review output.",
            `Reward agent confidence for ${finding.agentName} on ${finding.issueType}.`,
            ...(learningNotes ? [`Learning notes: ${learningNotes}`] : []),
          ]),
          confidence: "0.95",
          provider: "ai-review-import",
          wasUseful: 1,
          producedBugs: 1,
          qualityScore: 0.95,
        });
        kbEntriesAdded += 1;
      } else if (verdict.verdict === "false_positive") {
        falsePositiveCount += 1;

        await db.insert(knowledgeTable).values({
          problemType: `false_positive_${issuePattern}`,
          language,
          fileType,
          patternTags: `false-positive,review-import,needs-improvement,${issuePattern}`,
          question: `False positive finding #${finding.findingNumber} in ${finding.filePath}: ${finding.findingText}`,
          contextHash: `${finding.filePath}:false-positive:${issuePattern}`,
          codeSnippet: snippet,
          answer: `AI reviewer verdict: FALSE POSITIVE. Improve pattern matching for ${finding.issueType}.`,
          actionItems: JSON.stringify([
            "Reduce confidence when similar pattern appears again without proof.",
            `Flag detector heuristics for ${finding.issueType} as needing improvement.`,
            ...(learningNotes ? [`Learning notes: ${learningNotes}`] : []),
          ]),
          confidence: "0.90",
          provider: "ai-review-import",
          wasUseful: 0,
          producedBugs: 0,
          qualityScore: 0.2,
        });
        kbEntriesAdded += 1;
      }
    }

    const ROLE_CONFIDENCE_STEP = 0.03;
    for (const adjustment of learningAdjustments) {
      if (adjustment.confidenceRole && adjustment.confidenceDelta !== 0) {
        const matchingAgents = agents.filter(agent => roleMatches(agent.role, adjustment.confidenceRole ?? ""));

        for (const agent of matchingAgents) {
          const signedDelta = adjustment.confidenceDelta * ROLE_CONFIDENCE_STEP;
          roleConfidenceDeltaByAgent.set(agent.id, (roleConfidenceDeltaByAgent.get(agent.id) ?? 0) + signedDelta);
        }
      }

      if (!adjustment.avoidPattern) continue;

      const avoidPatternTag = normalizeIssuePattern(adjustment.avoidPattern);
      await db.insert(knowledgeTable).values({
        problemType: "review_import_avoid_pattern",
        language: "meta",
        fileType: "learning",
        patternTags: `avoid-pattern,review-import,${avoidPatternTag}`,
        question: `Avoid pattern from AI review: ${adjustment.avoidPattern}`,
        contextHash: `review-import:avoid:${avoidPatternTag}`,
        answer: `Agent instruction captured: should NEVER ${adjustment.avoidPattern}.`,
        actionItems: JSON.stringify([
          "Down-rank findings that match this avoid pattern unless hard evidence is present.",
          `Source instruction: ${adjustment.agentName}: ${adjustment.adjustment}`,
        ]),
        confidence: "0.85",
        provider: "ai-review-import",
        wasUseful: 1,
        producedBugs: 0,
        qualityScore: 0.7,
      });
      kbEntriesAdded += 1;
    }

    const accuracyChanges: Array<{ agentName: string; before: number; after: number }> = [];
    const impactedAgentIds = new Set<string>([
      ...Array.from(perAgentDelta.keys()),
      ...Array.from(roleConfidenceDeltaByAgent.keys()),
      ...Array.from(personalKbUpdatedAgentIds),
    ]);

    for (const agentId of impactedAgentIds) {
      const agent = agentsById.get(agentId);
      if (!agent) continue;

      const verdictDelta = perAgentDelta.get(agentId);
      const nextTruePositives = agent.truePositives + (verdictDelta?.tp ?? 0);
      const nextFalsePositives = agent.falsePositives + (verdictDelta?.fp ?? 0);
      const reviewedTotal = nextTruePositives + nextFalsePositives;
      const nextPersonalKb = nextPersonalKbByAgentId.get(agentId) ?? agent.personalKB;

      let nextAccuracy = reviewedTotal > 0 ? nextTruePositives / reviewedTotal : agent.accuracy;
      const roleDelta = roleConfidenceDeltaByAgent.get(agentId) ?? 0;
      if (roleDelta !== 0) {
        nextAccuracy = Math.max(0.01, Math.min(0.99, nextAccuracy + roleDelta));
      }

      const personalKbChanged = nextPersonalKb !== agent.personalKB;

      const noMetricChange = nextTruePositives === agent.truePositives
        && nextFalsePositives === agent.falsePositives
        && Math.abs(nextAccuracy - agent.accuracy) < 0.0001
        && !personalKbChanged;
      if (noMetricChange) continue;

      await db.update(agentsTable).set({
        truePositives: nextTruePositives,
        falsePositives: nextFalsePositives,
        accuracy: nextAccuracy,
        personalKB: nextPersonalKb,
      }).where(eq(agentsTable.id, agent.id));

      updatedAgentNames.add(agent.name);

      accuracyChanges.push({
        agentName: agent.name,
        before: Math.round(agent.accuracy * 1000) / 10,
        after: Math.round(nextAccuracy * 1000) / 10,
      });
    }

    accuracyChanges.sort((a, b) => b.after - a.after);

    const commonConfirmedPatterns = Array.from(confirmedPatternCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, countValue]) => `${pattern} (${countValue})`);

    const importedAt = new Date().toISOString();
    const summaryRecord: ImportedReviewSummary = {
      importedAt,
      verdictsProcessed,
      realBugCount,
      falsePositiveCount,
      agentsUpdated: Array.from(updatedAgentNames),
      kbEntriesAdded,
      commonConfirmedPatterns,
      implementedFixSummary,
    };

    if (kbEntriesAdded > 0) {
      invalidateKnowledgeSearchCache();
    }

    await writeMayorReviewContext(summaryRecord);

    const biggestGain = accuracyChanges
      .slice()
      .sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];

    const mayorMessage = biggestGain
      ? `Got it. I've updated ${updatedAgentNames.size} agent(s) based on this review. ${biggestGain.agentName} accuracy improved to ${biggestGain.after.toFixed(1)}%.`
      : `Got it. I've updated ${updatedAgentNames.size} agent(s) based on this review. No AI-verified accuracy increase yet, but I logged the learning data.`;

    res.json({
      verdictsProcessed,
      agentsUpdated: Array.from(updatedAgentNames),
      kbEntriesAdded,
      accuracyChanges,
      phase2ReinforcementCount,
      mayorMessage,
      lastReviewSummary: implementedFixSummary,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "IMPORT_REVIEW_ERROR", message: detail });
  }
});

router.post("/generate-test", async (req, res): Promise<void> => {
  const buildingId = typeof req.body?.buildingId === "string" ? req.body.buildingId.trim() : "";
  const requestedFilePath = typeof req.body?.filePath === "string" ? req.body.filePath.trim() : "";

  if (!buildingId && !requestedFilePath) {
    res.status(400).json({ error: "INVALID_REQUEST", message: "buildingId or filePath is required" });
    return;
  }

  try {
    const [repoContext, settings] = await Promise.all([
      getLatestRepoContext(),
      readOrchestratorModelSettings(),
    ]);

    const snapshot = repoContext.snapshot;
    const building = buildingId
      ? snapshot.allBuildings.find(item => item.id === buildingId) ?? null
      : null;

    const sourceFilePath = requestedFilePath || building?.filePath || "";
    if (!sourceFilePath) {
      res.status(404).json({ error: "SOURCE_NOT_FOUND", message: "Could not resolve a source file path" });
      return;
    }

    const normalizedSourceFilePath = normalizePathForLookup(sourceFilePath);
    const localFileContent = await readLocalFileFirst(normalizedSourceFilePath);
    const remoteFileContent = localFileContent
      ? null
      : await fetchGithubFileContent(repoContext.repoUrl, repoContext.branch, normalizedSourceFilePath);
    const fileContent = localFileContent ?? remoteFileContent;

    if (!fileContent) {
      res.status(404).json({
        error: "FILE_CONTENT_UNAVAILABLE",
        message: `Could not fetch content for ${sourceFilePath}. Ensure the active repository is a reachable GitHub repository.`,
      });
      return;
    }

    let testContent = "";
    let generationMode: "ai" | "fallback" = "ai";
    try {
      testContent = await callGroqTestEngineer({
        model: settings.groqModel,
        filePath: normalizedSourceFilePath,
        fileContent,
      });
    } catch {
      testContent = buildFallbackTestContent(normalizedSourceFilePath, fileContent);
      generationMode = "fallback";
    }

    const language = detectSourceLanguage(normalizedSourceFilePath);
    const testFilePath = toRecommendedTestFilePath(normalizedSourceFilePath);
    const proposal = rememberTestProposal({
      sourceFilePath: normalizedSourceFilePath,
      testFilePath,
      testContent,
      language,
      buildingId: building?.id ?? (buildingId || null),
      generatedByRole: "scribe",
    });

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: "test_proposed",
      buildingId: proposal.buildingId,
      buildingName: building?.name ?? basename(normalizedSourceFilePath),
      message: `Scribe drafted ${proposal.testFilePath} for ${proposal.sourceFilePath}`,
      severity: "info",
    }).catch(() => {});

    wsServer.broadcastEventLog(
      "HEALING_LOOP",
      `Scribe drafted ${proposal.testFilePath} for ${proposal.sourceFilePath}`,
      "info",
    );

    res.json({
      proposalId: proposal.proposalId,
      generatedAt: proposal.createdAt,
      sourceFilePath: proposal.sourceFilePath,
      testFilePath,
      testContent,
      language,
      generatedByRole: "scribe",
      generationMode,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "GENERATE_TEST_ERROR", message: detail });
  }
});

router.post("/approve-test", async (req, res): Promise<void> => {
  const proposalId = typeof req.body?.proposalId === "string" ? req.body.proposalId.trim() : "";
  const requestedSourceFilePath = typeof req.body?.sourceFilePath === "string" ? req.body.sourceFilePath.trim() : "";
  const requestedTestFilePath = typeof req.body?.testFilePath === "string" ? req.body.testFilePath.trim() : "";
  const requestedTestContent = typeof req.body?.testContent === "string" ? req.body.testContent : "";
  const overwrite = req.body?.overwrite === true;
  const approved = req.body?.approved !== false;

  try {
    const proposal = proposalId ? getPendingTestProposal(proposalId) : null;

    if (!approved) {
      if (proposal) pendingTestProposals.delete(proposal.proposalId);
      res.json({ success: true, discarded: true, proposalId: proposal?.proposalId ?? null });
      return;
    }

    const sourceFilePath = normalizePathForLookup(proposal?.sourceFilePath ?? requestedSourceFilePath);
    const normalizedTestFilePath = normalizeRelativeWritePath(proposal?.testFilePath ?? requestedTestFilePath);
    const testContent = (requestedTestContent || proposal?.testContent || "").trim();

    if (!sourceFilePath || !normalizedTestFilePath || !testContent) {
      res.status(400).json({
        error: "INVALID_APPROVAL_REQUEST",
        message: "proposalId or sourceFilePath/testFilePath/testContent is required",
      });
      return;
    }

    const repoRoot = await resolveWritableRepoRoot(sourceFilePath);
    if (!repoRoot) {
      res.status(409).json({
        error: "LOCAL_REPO_REQUIRED",
        message: "No writable local repository root was found. Start local watch mode before approving test files.",
      });
      return;
    }

    const targetAbsolutePath = resolveFilePathInRepo(repoRoot, normalizedTestFilePath);
    if (!targetAbsolutePath) {
      res.status(400).json({ error: "INVALID_TEST_PATH", message: "testFilePath must stay within the repo root" });
      return;
    }

    const fileAlreadyExists = await pathExistsOnDisk(targetAbsolutePath);
    if (fileAlreadyExists && !overwrite) {
      res.status(409).json({
        error: "TEST_FILE_EXISTS",
        message: `${normalizedTestFilePath} already exists. Re-submit with overwrite=true to replace it.`,
      });
      return;
    }

    await mkdirOnDisk(dirname(targetAbsolutePath), { recursive: true });
    await writeFileOnDisk(targetAbsolutePath, `${testContent.trimEnd()}\n`, "utf8");

    const activeRepo = await db.select().from(reposTable).where(eq(reposTable.isActive, true)).limit(1);
    const repoRow = activeRepo[0]
      ?? (await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1))[0]
      ?? null;

    let healthScore: number | null = null;
    let season: string | null = null;

    if (repoRow?.layoutData) {
      const parsedLayout = parseLayout(repoRow.layoutData);
      if (parsedLayout) {
        const normalizedSource = normalizePathForLookup(sourceFilePath).toLowerCase();
        let updatedBuilding: Building | null = null;

        const nextDistricts = parsedLayout.districts.map((district) => ({
          ...district,
          buildings: district.buildings.map((building) => {
            if (normalizePathForLookup(building.filePath).toLowerCase() !== normalizedSource) return building;

            const improvedCoverage = Math.max(building.testCoverage, 0.2);
            const nextStatus = building.status === "fire" || building.status === "error"
              ? "warning"
              : building.status;

            updatedBuilding = {
              ...building,
              hasTests: true,
              testCoverage: improvedCoverage,
              status: nextStatus,
              activeEvent: nextStatus === "warning" ? "alarm" : building.activeEvent,
              lastAnalyzed: new Date().toISOString(),
            };

            return updatedBuilding;
          }),
        }));

        const recalculated = {
          ...parsedLayout,
          districts: nextDistricts,
        };
        const allBuildings = recalculated.districts.flatMap((district) => district.buildings);
        const health = computeHealthScore(allBuildings);
        healthScore = health.score;
        season = health.season;
        const nextLayout: CityLayout = {
          ...recalculated,
          healthScore: health.score,
          season: health.season as CityLayout["season"],
        };

        await db.update(reposTable).set({
          layoutData: JSON.stringify(nextLayout),
          healthScore: health.score,
          season: health.season,
          updatedAt: new Date().toISOString(),
        }).where(eq(reposTable.id, repoRow.id));

        if (updatedBuilding) {
          wsServer.broadcastCityPatch(updatedBuilding, health.score, health.season);
        }
      }
    }

    if (proposal) pendingTestProposals.delete(proposal.proposalId);

    await db.insert(eventsTable).values({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: "test_approved",
      buildingId: proposal?.buildingId ?? null,
      buildingName: basename(sourceFilePath),
      message: `Scribe approved and wrote ${normalizedTestFilePath}`,
      severity: "info",
    }).catch(() => {});

    wsServer.broadcastEventLog(
      "HEALING_LOOP",
      `Scribe approved and wrote ${normalizedTestFilePath}`,
      "info",
    );

    res.json({
      success: true,
      proposalId: proposal?.proposalId ?? null,
      sourceFilePath,
      testFilePath: normalizedTestFilePath,
      writtenTo: targetAbsolutePath,
      overwritten: fileAlreadyExists && overwrite,
      repoRoot,
      healthScore,
      season,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "APPROVE_TEST_ERROR", message: detail });
  }
});

async function resetAgentStats(mode: "idle" | "retired"): Promise<number> {
  const agents = await db.select({ id: agentsTable.id }).from(agentsTable);

  for (const agent of agents) {
    await db.update(agentsTable).set({
      status: mode,
      currentBuilding: null,
      currentTask: null,
      bugsFound: 0,
      testsGenerated: 0,
      escalations: 0,
      truePositives: 0,
      falsePositives: 0,
      escalationCount: 0,
      kbHits: 0,
      visitedFiles: "[]",
      personalKB: "[]",
      specialtyScore: 0,
      lastFileHash: null,
      totalTasksCompleted: 0,
      accuracy: 0.8,
      level: 1,
      rank: "junior",
      dialogue: mode === "retired" ? "Retired by city control." : "Ready to inspect code...",
    }).where(eq(agentsTable.id, agent.id));
  }

  return agents.length;
}

router.post("/controls/clear-events", async (_req, res) => {
  try {
    await db.delete(eventsTable);
    res.json({ success: true, message: "Event stream cleared." });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "CLEAR_EVENTS_ERROR", message: detail });
  }
});

router.post("/controls/reset-agent-stats", async (_req, res) => {
  try {
    const updated = await resetAgentStats("idle");
    res.json({ success: true, message: `Reset stats for ${updated} agent(s).` });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "RESET_AGENT_STATS_ERROR", message: detail });
  }
});

router.post("/controls/retire-all-agents", async (_req, res) => {
  try {
    const updated = await resetAgentStats("retired");
    res.json({ success: true, message: `Retired ${updated} agent(s).` });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "RETIRE_ALL_ERROR", message: detail });
  }
});

router.post("/controls/cleanup-kb", async (_req, res) => {
  try {
    const result = await cleanupNonSourceKnowledgeAndRecountBugs();
    res.json({ removed: result.removed, remaining: result.remaining });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "CLEANUP_KB_ERROR", message: detail });
  }
});

router.post("/controls/full-reset", async (_req, res) => {
  try {
    await db.delete(eventsTable);
    await db.delete(executionResultsTable);
    await resetAgentStats("idle");
    resetKbSessionStats();
    res.json({ success: true, message: "Full city reset complete, including KB session stats." });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "FULL_RESET_ERROR", message: detail });
  }
});

router.post("/controls/wipe-all", async (req, res): Promise<void> => {
  const confirmation = typeof req.body?.confirmation === "string" ? req.body.confirmation.trim() : "";
  if (confirmation !== "RESET") {
    res.status(400).json({ error: "CONFIRMATION_REQUIRED", message: "Send confirmation='RESET' to wipe everything." });
    return;
  }

  try {
    await db.delete(eventsTable);
    await db.delete(metricSnapshotsTable);
    await db.delete(snapshotsTable);
    await db.delete(executionResultsTable);
    await db.delete(knowledgeTable);
    invalidateKnowledgeSearchCache({ resetVectorCache: true });
    await db.delete(agentsTable);
    await db.delete(reposTable);
    await db.delete(settingsTable);
    resetKbSessionStats();

    res.json({ success: true, message: "All city data wiped." });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "WIPE_ALL_ERROR", message: detail });
  }
});

void ensureMayorMemoryLoaded();
startMayorInsightLoop();

export default router;
