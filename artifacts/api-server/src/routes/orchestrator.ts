import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  agentsTable,
  eventsTable,
  knowledgeTable,
  metricSnapshotsTable,
  reposTable,
  settingsTable,
  snapshotsTable,
} from "@workspace/db/schema";
import { count, desc, eq, inArray } from "drizzle-orm";
import { basename, extname } from "node:path";
import { orchestrator } from "../lib/orchestrator";
import { getKbSessionStats, resetKbSessionStats } from "../lib/sessionStats";
import type { Building, CityLayout } from "../lib/types";

const router: IRouter = Router();

const ORCHESTRATOR_MODEL_KEYS = ["groq_model", "mayor_name"] as const;
const MAYOR_TASK_EVENT_TYPES = new Set(["bug_found", "test_passed", "escalation"]);
const MAYOR_SOURCE_FILE_EXTENSIONS = new Set([".ts", ".js", ".py", ".go", ".rs"]);
const MAYOR_EXCLUDED_DOC_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".mdx"]);
const MAYOR_FILE_QUERY_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]);
const URGENCY_SOURCE_EXTENSIONS = new Set([".ts", ".js", ".py", ".go", ".rs"]);
const URGENCY_DOC_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json"]);
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
  buildingName: string | null;
  agentName: string | null;
  agentId: string | null;
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

const mayorSessionConversations = new Map<string, MayorConversationEntry[]>();

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
    };
  }

  const layout = parseLayout(source.layoutData);
  return {
    snapshot: toCitySnapshot(layout, source.repoName),
    repoUrl: source.repoUrl,
    branch: source.branch ?? "main",
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

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
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
    const res = await fetch(contentUrl, { headers: githubHeaders() });
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

  const completeSentences = normalized.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()).filter(Boolean) ?? [];
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
    const lowerMessage = message.toLowerCase();
    const shouldBuildTestRecommendations = lowerMessage.includes("test")
      && (lowerMessage.includes("create") || lowerMessage.includes("write") || lowerMessage.includes("add") || lowerMessage.includes("make"));

    const [repoContext, agents, events, settings, kbCount] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(80),
      readOrchestratorModelSettings(),
      db.select({ total: count() }).from(knowledgeTable),
    ]);
    const snapshot = repoContext.snapshot;

    const eventRows: MayorEventRow[] = events.map(event => ({
      type: event.type,
      message: event.message,
      severity: event.severity,
      timestamp: event.timestamp,
      buildingName: event.buildingName,
      agentName: event.agentName,
      agentId: event.agentId,
    }));
    const contextEvents = eventRows.filter(includeEventInMayorContext);

    const activeAgents = agents.filter(a => a.status === "working").length;
    const idleAgents = agents.filter(a => a.status === "idle").length;
    const criticalEvents = events.filter(e => e.severity === "critical").length;
    const computedStatus = statusLine(snapshot, criticalEvents, activeAgents);
    const recentBugSummaries = collectRecentBugSummaries(contextEvents);
    const kbEntries = kbCount[0]?.total ?? 0;
    const kbSessionStats = getKbSessionStats();
    const kbHitRatePercent = Math.round(kbSessionStats.kbHitRate * 100);
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
    const referencedFilePath = resolveMayorFilePathFromQuestion(message, snapshot);

    const systemPrompt = [
      `You are ${settings.mayorName}, the AI mayor of Software City.`,
      "You are a senior software engineer and project manager.",
      "You speak like a real person - direct, specific, occasionally dry humor.",
      "You never repeat what you just said.",
      "You answer exactly what is asked.",
      "You use 'I' not 'The city'.",
      "You say 'I noticed' and 'I recommend' not 'It is recommended'.",
      "You admit when you don't know something.",
      `You remember this conversation: ${conversationHistoryText}`,
      `Current city state: ${cityContext}`,
      `Recent events: ${recentEventsText}`,
      `Current fires: ${currentFires}`,
      `Recent bugs found: ${recentBugsText}`,
      "Tests only apply to source code files (.ts, .js, .py, .go, .rs). Never mention markdown or documentation files as test targets. If asked what tests you run, only reference actual source files.",
      "Keep answers to 2-3 sentences. End every sentence completely.",
    ].join(" ");

    let reply = "";
    let provider = "fallback";
    let model = "rule-based";
    let source: "db" | "rule-based" | "ai" = "rule-based";
    let cost = 0;

    if (referencedFilePath) {
      try {
        if (!process.env["GROQ_API_KEY"]) throw new Error("missing_groq_key");

        const fileContent = await fetchGithubFileContent(repoContext.repoUrl, repoContext.branch, referencedFilePath);
        if (!fileContent) {
          reply = [
            `I found ${referencedFilePath}, but I cannot read its source content right now.`,
            "I recommend verifying the active repository points to a reachable GitHub source, then ask again and I will give line-specific advice.",
          ].join(" ");
          provider = "rule-based";
          model = "file-content-unavailable";
          source = "rule-based";
          cost = 0;
        } else {
          const fileAwareQuestion = [
            `User question: ${message}`,
            `Target file: ${referencedFilePath}`,
            "Use this file content to provide concrete, file-specific guidance. Call out likely risky functions, failure modes, and the next tests to add.",
            "File content starts below:",
            trimFileContentForPrompt(fileContent),
          ].join("\n\n");

          reply = await callGroqMayor({
            model: settings.groqModel,
            systemPrompt,
            conversationHistory,
            userMessage: fileAwareQuestion,
          });
          provider = "groq";
          model = settings.groqModel;
          source = "ai";
          cost = 1;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        console.warn(`[MayorChat] file-path fallback reason=${detail}`);
        reply = [
          `I detected a file-specific question about ${referencedFilePath}, but file analysis is temporarily unavailable.`,
          "Ask me again after Groq and repository access are healthy, and I will give precise recommendations for that file.",
        ].join(" ");
        provider = "rule-based";
        model = "file-analysis-fallback";
        source = "rule-based";
        cost = 0;
      }
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
        if (!process.env["GROQ_API_KEY"]) throw new Error("missing_groq_key");
        reply = await callGroqMayor({
          model: settings.groqModel,
          systemPrompt,
          conversationHistory,
          userMessage: message,
        });
        provider = "groq";
        model = settings.groqModel;
        source = "ai";
        cost = 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        console.warn(`[MayorChat] fallback reason=${detail}`);
        reply = [
          `I could not reach Groq, so I am answering from live city telemetry for your question: ${message}.`,
          `${computedStatus} Focus next on high-complexity low-coverage files and recent bug hotspots.`,
          "Ask about specific bugs, worst files, agent activity, or health-score improvements for precise guidance.",
        ].join(" ");
        source = "rule-based";
        cost = 0;
      }
    }

    const finalMessage = provider === "rule-based" || provider === "db"
      ? reply.trim()
      : ensureCompleteMayorReply(reply, [
        `${computedStatus}`,
        "Prioritize high-risk files and run targeted tests.",
        "Request the urgency report again after fixes to confirm progress.",
      ]);

    const dedupedMessage = avoidRepeatedMayorReply({
      history: conversationHistory,
      reply: finalMessage,
      userMessage: message,
      computedStatus,
    });

    appendMayorConversation(sessionId, "user", message);
    appendMayorConversation(sessionId, "assistant", dedupedMessage);

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

    // Always query current DB state on each request (no cached report artifact).
    const [repoContext, agents, events, kbCount] = await Promise.all([
      getLatestRepoContext(),
      db.select().from(agentsTable),
      db.select().from(eventsTable).orderBy(desc(eventsTable.timestamp)).limit(80),
      db.select({ total: count() }).from(knowledgeTable),
    ]);
    const snapshot = repoContext.snapshot;

    const activeAgents = agents.filter(a => a.status === "working").length;
    const idleAgents = agents.filter(a => a.status === "idle").length;
    const criticalEvents = events.filter(e => e.severity === "critical");
    const warningEvents = events.filter(e => e.severity === "warning");

    const urgencyBuildings = snapshot.allBuildings.filter(isUrgencySourceBuilding);
    const urgencyBuildingIds = new Set(urgencyBuildings.map(building => building.id));
    const urgencyFireBuildings = snapshot.fireBuildings.filter(building => urgencyBuildingIds.has(building.id));
    const urgencyHighRiskBuildings = snapshot.highRiskBuildings.filter(building => urgencyBuildingIds.has(building.id));
    const elevatedUrgencyIds = new Set(urgencyHighRiskBuildings.map(building => building.id));

    const criticalItems = [
      ...urgencyFireBuildings.slice(0, 6).map(b => `${b.name} (${b.filePath}) is in ${b.status} state.`),
      ...criticalEvents.slice(0, 6).map(e => `Event: ${e.message}`),
    ];

    const highItems = [
      ...urgencyHighRiskBuildings
        .filter(b => b.status !== "fire" && b.status !== "error")
        .slice(0, 8)
        .map(b => `${b.name} (${b.filePath}) has complexity ${b.complexity} and coverage ${(b.testCoverage * 100).toFixed(0)}%.`),
      ...warningEvents.slice(0, 4).map(e => `Event: ${e.message}`),
    ];

    const mediumItems = urgencyBuildings
      .filter(building => building.testCoverage >= 0.1 && building.testCoverage <= 0.8)
      .filter(building => !elevatedUrgencyIds.has(building.id))
      .slice(0, 10)
      .map(building => `${building.name} (${building.filePath}) has partial coverage ${(building.testCoverage * 100).toFixed(0)}% and complexity ${building.complexity}.`);

    const cityStatsItems = [
      `Untested or low-coverage buildings: ${snapshot.untestedBuildings}.`,
      `Knowledge base entries available: ${kbCount[0]?.total ?? 0}.`,
      activeAgents === 0 ? "No agents are currently active." : `${activeAgents} agents currently active; ${idleAgents} idle.`,
      `Season signal: ${snapshot.season}.`,
      `Total buildings tracked: ${snapshot.totalBuildings}.`,
      `Current health score: ${Math.round(snapshot.healthScore)}.`,
    ];

    const recommendedTestFiles = await buildTestRecommendations({
      snapshot,
      repoUrl: repoContext.repoUrl,
      branch: repoContext.branch,
      limit: 5,
    });

    const buckets = {
      critical: criticalItems,
      high: highItems,
      medium: mediumItems,
      cityStats: cityStatsItems,
    };

    const recommendationLines = recommendedTestFiles.length > 0
      ? recommendedTestFiles.flatMap((recommendation, index) => [
        `${index + 1}. Filename: ${recommendation.testFilePath}`,
        `   What to test: ${recommendation.whatToTest.map(fn => `${fn}()`).join(", ")}`,
        `   Test type: ${recommendation.testType}`,
        `   Priority: ${recommendation.priority}`,
      ])
      : ["- None"];

    const reportLines = [
      `# Urgency Report — ${snapshot.repoName}`,
      "",
      `Generated: ${requestedAt}`,
      statusLine(snapshot, criticalEvents.length, activeAgents),
      "",
      `## Critical (${buckets.critical.length})`,
      ...(buckets.critical.length > 0 ? buckets.critical.map(item => `- ${item}`) : ["- None"]),
      "",
      `## High (${buckets.high.length})`,
      ...(buckets.high.length > 0 ? buckets.high.map(item => `- ${item}`) : ["- None"]),
      "",
      `## Medium (${buckets.medium.length})`,
      ...(buckets.medium.length > 0 ? buckets.medium.map(item => `- ${item}`) : ["- None"]),
      "",
      "## Recommended Immediate Actions",
      "- Assign one agent to each critical building and run analyze + tests before any new feature work.",
      "- Convert high-risk low-coverage files into targeted test tickets with explicit owners.",
      "- Re-check urgency report after one cycle to verify critical bucket reduction.",
      "",
      `## Recommended Test Files to Create (${recommendedTestFiles.length})`,
      ...recommendationLines,
      "",
      `## City Stats (${buckets.cityStats.length})`,
      ...buckets.cityStats.map(item => `- ${item}`),
    ];

    const report = reportLines.join("\n");

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    res.json({
      report,
      buckets,
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

    const fileContent = await fetchGithubFileContent(repoContext.repoUrl, repoContext.branch, sourceFilePath);
    if (!fileContent) {
      res.status(404).json({
        error: "FILE_CONTENT_UNAVAILABLE",
        message: `Could not fetch content for ${sourceFilePath}. Ensure the active repository is a reachable GitHub repository.`,
      });
      return;
    }

    const testContent = await callGroqTestEngineer({
      model: settings.groqModel,
      filePath: sourceFilePath,
      fileContent,
    });

    const language = detectSourceLanguage(sourceFilePath);
    const testFilePath = toRecommendedTestFilePath(sourceFilePath);

    res.json({
      testFilePath,
      testContent,
      language,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "GENERATE_TEST_ERROR", message: detail });
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

router.post("/controls/full-reset", async (_req, res) => {
  try {
    await db.delete(eventsTable);
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
    await db.delete(knowledgeTable);
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

export default router;
