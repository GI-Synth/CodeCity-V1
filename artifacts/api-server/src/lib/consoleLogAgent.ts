/**
 * Console Log Agent — Part 5 of the CodeCity Intelligence Master Plan.
 *
 * Continuously reads and parses runtime console output.
 * Classifies logs: error, warning, performance, info.
 * Maps log entries back to source file + line number.
 * Reports runtime errors to Mayor with full context.
 * Correlates repeated errors with code graph to find root cause.
 */

import { db } from "@workspace/db";
import { logEntriesTable } from "@workspace/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { broadcastFinding, escalateToMayor } from "./agentMessageBus";

// ── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = "error" | "warn" | "perf" | "info";

export interface ParsedLogEntry {
  level: LogLevel;
  raw: string;
  message: string;
  stackTrace: string | null;
  file: string | null;
  line: number | null;
  errorType: string | null;
  perfLabel: string | null;
  perfDuration: number | null;
}

interface LogStats {
  totalProcessed: number;
  byLevel: Record<LogLevel, number>;
  escalated: number;
}

// ── State ────────────────────────────────────────────────────────────────────

let running = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
const stats: LogStats = { totalProcessed: 0, byLevel: { error: 0, warn: 0, perf: 0, info: 0 }, escalated: 0 };

// Ring buffer for incoming logs before they're flushed to DB
const pendingLogs: ParsedLogEntry[] = [];
const MAX_PENDING = 500;

// Track error frequency per file for escalation
const errorFrequency = new Map<string, { count: number; lastSeen: number }>();
const ESCALATION_THRESHOLD = 5; // escalate if same file errors 5+ times in window
const ESCALATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── Log parsing ──────────────────────────────────────────────────────────────

const STACK_TRACE_REGEX = /at\s+.*\(?(\/[^)]+|[a-zA-Z]:\\[^)]+)(?::(\d+)(?::(\d+))?)?\)?/;
const FILE_LINE_REGEX = /(?:\/|[a-zA-Z]:\\)[\w/.\\-]+\.[a-zA-Z]+(?::(\d+))?/;
const PERF_TIMING_REGEX = /\[?(?:perf|timing|duration|elapsed)\]?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:ms|s)/i;
const ERROR_TYPE_REGEX = /^(\w+Error|TypeError|RangeError|ReferenceError|SyntaxError|ENOENT|ECONNREFUSED|SQLITE_\w+)\b/;

function classifyLevel(raw: string): LogLevel {
  const lower = raw.toLowerCase();
  if (lower.includes("[error]") || lower.includes("error:") || lower.includes("uncaught") || lower.includes("unhandled")) return "error";
  if (lower.includes("[warn]") || lower.includes("warning:") || lower.includes("deprecated")) return "warn";
  if (PERF_TIMING_REGEX.test(raw)) return "perf";
  // stderr common markers
  if (lower.startsWith("error") || lower.includes("fatal") || lower.includes("exception")) return "error";
  if (lower.includes("warn")) return "warn";
  return "info";
}

function extractStackFile(raw: string): { file: string | null; line: number | null } {
  const lines = raw.split("\n");
  for (const line of lines) {
    const m = STACK_TRACE_REGEX.exec(line);
    if (m) {
      return { file: m[1] ?? null, line: m[2] ? parseInt(m[2], 10) : null };
    }
  }
  // Fallback: try file:line pattern
  const fm = FILE_LINE_REGEX.exec(raw);
  if (fm) {
    const filePath = fm[0].split(":")[0];
    return { file: filePath, line: fm[1] ? parseInt(fm[1], 10) : null };
  }
  return { file: null, line: null };
}

function extractErrorType(raw: string): string | null {
  const m = ERROR_TYPE_REGEX.exec(raw);
  return m ? m[1] : null;
}

function extractPerf(raw: string): { label: string | null; duration: number | null } {
  const m = PERF_TIMING_REGEX.exec(raw);
  if (!m) return { label: null, duration: null };
  const duration = parseFloat(m[1]);
  const label = raw.slice(0, Math.max(0, raw.indexOf(m[0]))).replace(/[\[\]:=\s]+$/, "").trim() || "timing";
  return { label, duration: m[0].includes("s") && !m[0].includes("ms") ? duration * 1000 : duration };
}

/** Parse a single raw log line into a structured entry. */
export function parseLogLine(raw: string): ParsedLogEntry {
  const trimmed = raw.trim();
  const level = classifyLevel(trimmed);
  const { file, line } = extractStackFile(trimmed);
  const errorType = level === "error" ? extractErrorType(trimmed) : null;
  const perf = level === "perf" ? extractPerf(trimmed) : { label: null, duration: null };

  // Extract stack trace (everything after first newline that starts with "at ")
  let stackTrace: string | null = null;
  const nlIdx = trimmed.indexOf("\n");
  if (nlIdx > 0) {
    const rest = trimmed.slice(nlIdx + 1).trim();
    if (rest.includes("at ")) {
      stackTrace = rest;
    }
  }

  // Message is the first line only
  const message = nlIdx > 0 ? trimmed.slice(0, nlIdx).trim() : trimmed;

  return {
    level,
    raw: trimmed.slice(0, 2000), // cap storage size
    message: message.slice(0, 500),
    stackTrace: stackTrace?.slice(0, 2000) ?? null,
    file,
    line,
    errorType,
    perfLabel: perf.label,
    perfDuration: perf.duration,
  };
}

// ── Ingestion ────────────────────────────────────────────────────────────────

/** Ingest a raw log string (can be multi-entry separated by newlines). */
export function ingestLog(raw: string): void {
  if (!raw.trim()) return;

  // Split on lines that look like new log entries (timestamp or level prefix)
  const entries = raw.split(/\n(?=\d{4}-|\[\w+\]|(?:error|warn|info)[\s:])/i);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parsed = parseLogLine(trimmed);
    pendingLogs.push(parsed);
    stats.totalProcessed++;
    stats.byLevel[parsed.level]++;
  }

  // Cap pending buffer
  while (pendingLogs.length > MAX_PENDING) {
    pendingLogs.shift();
  }
}

// ── Flush & Escalation ───────────────────────────────────────────────────────

async function flushPending(): Promise<void> {
  if (pendingLogs.length === 0) return;

  const batch = pendingLogs.splice(0, pendingLogs.length);
  const now = Date.now();

  for (const entry of batch) {
    await db.insert(logEntriesTable).values({
      timestamp: now,
      level: entry.level,
      raw: entry.raw,
      message: entry.message,
      stackTrace: entry.stackTrace,
      file: entry.file,
      line: entry.line,
      errorType: entry.errorType,
      perfLabel: entry.perfLabel,
      perfDuration: entry.perfDuration,
      sourceNodeId: null,
      occurrenceCount: 1,
    });

    // Track error frequency for escalation
    if (entry.level === "error" && entry.file) {
      const key = entry.file;
      const freq = errorFrequency.get(key);
      if (freq && now - freq.lastSeen < ESCALATION_WINDOW_MS) {
        freq.count++;
        freq.lastSeen = now;
        if (freq.count === ESCALATION_THRESHOLD) {
          await escalateRepeatedError(key, freq.count, entry.message);
        }
      } else {
        errorFrequency.set(key, { count: 1, lastSeen: now });
      }
    }
  }
}

async function escalateRepeatedError(file: string, count: number, lastMessage: string): Promise<void> {
  stats.escalated++;
  const msg = `🚨 Repeated error (${count}x in 5min) in ${file}: ${lastMessage.slice(0, 200)}`;
  await broadcastFinding("console_log", msg, `log-escalation-${file}`);
  await escalateToMayor("console_log", msg, `log-escalation-${file}`, {
    file,
    occurrences: count,
    windowMs: ESCALATION_WINDOW_MS,
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Starts the console log agent flush loop. */
export function startConsoleLogAgent(intervalMs = 10_000): void {
  if (running) return;
  running = true;
  intervalId = setInterval(() => {
    flushPending().catch(err => console.warn("[ConsoleLogAgent] Flush error:", err));
  }, intervalMs);
  console.log("[ConsoleLogAgent] Started — flushing every", intervalMs, "ms");
}

/** Stops the console log agent. */
export function stopConsoleLogAgent(): void {
  if (!running) return;
  running = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  // Final flush
  flushPending().catch(() => {});
  console.log("[ConsoleLogAgent] Stopped");
}

/** Get console log agent statistics. */
export function getConsoleLogStats(): LogStats & { pendingCount: number; trackedFiles: number } {
  return {
    ...stats,
    pendingCount: pendingLogs.length,
    trackedFiles: errorFrequency.size,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Get recent log entries from the database. */
export async function getRecentLogs(limit = 50, level?: LogLevel): Promise<unknown[]> {
  if (level) {
    return db
      .select()
      .from(logEntriesTable)
      .where(eq(logEntriesTable.level, level))
      .orderBy(desc(logEntriesTable.timestamp))
      .limit(limit);
  }
  return db
    .select()
    .from(logEntriesTable)
    .orderBy(desc(logEntriesTable.timestamp))
    .limit(limit);
}

/** Get error frequency by file in the last N minutes. */
export async function getErrorHotspots(windowMinutes = 60, limit = 20): Promise<{ file: string; count: number }[]> {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const rows = await db
    .select({
      file: logEntriesTable.file,
      count: sql<number>`count(*)`,
    })
    .from(logEntriesTable)
    .where(and(eq(logEntriesTable.level, "error"), gte(logEntriesTable.timestamp, cutoff)))
    .groupBy(logEntriesTable.file)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
  return rows
    .filter(r => r.file != null)
    .map(r => ({ file: r.file!, count: r.count }));
}
