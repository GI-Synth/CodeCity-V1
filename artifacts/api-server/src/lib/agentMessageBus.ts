/**
 * Agent Message Bus — Part 4 of the CodeCity Intelligence Master Plan.
 *
 * Real-time message bus where agents can:
 * - Broadcast findings to all other agents
 * - Direct-message a specific agent for peer review
 * - Vote on findings (upvote / downvote)
 * - Escalate to Mayor with full peer-reviewed context
 *
 * Messages are persisted in the agent_messages table and broadcast via WebSocket.
 */

import { db } from "@workspace/db";
import { agentMessagesTable } from "@workspace/db/schema";
import { desc, eq, and, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { wsServer } from "./wsServer";
import { personaEmoji, mapRoleToPersona } from "./smartAgents";

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentMessageType =
  | "finding"       // Agent reports a finding
  | "peer_review"   // Agent requests peer review from another agent
  | "vote"          // Agent votes on a finding (upvote / downvote)
  | "escalation"    // Agent escalates to Mayor
  | "mayor_response"// Mayor responds
  | "question"      // Agent asks a question
  | "info";         // General status / info

export interface AgentMessage {
  id: string;
  timestamp: number;
  fromAgent: string;
  toAgent: string; // "all" for broadcast, specific agent ID for DM, "mayor" for escalation
  messageType: AgentMessageType;
  content: string;
  findingId?: string | null;
  vote?: "up" | "down" | null;
  metadata: Record<string, unknown>;
}

type BusListener = (message: AgentMessage) => void;

// ── Message Bus ──────────────────────────────────────────────────────────────

const listeners = new Map<string, BusListener[]>();
const recentMessages: AgentMessage[] = [];
const MAX_RECENT = 200;

function trimRecent(): void {
  while (recentMessages.length > MAX_RECENT) {
    recentMessages.shift();
  }
}

/** Subscribe to messages directed to a specific agent ID (or "all" for broadcast). */
export function subscribe(agentId: string, listener: BusListener): () => void {
  const existing = listeners.get(agentId) ?? [];
  existing.push(listener);
  listeners.set(agentId, existing);

  return () => {
    const list = listeners.get(agentId);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  };
}

/** Publish a message onto the bus. Persists to DB, notifies listeners, and broadcasts via WS. */
export async function publish(msg: Omit<AgentMessage, "id" | "timestamp">): Promise<AgentMessage> {
  const full: AgentMessage = {
    ...msg,
    id: randomUUID(),
    timestamp: Date.now(),
  };

  // Persist to DB
  await db.insert(agentMessagesTable).values({
    id: full.id,
    timestamp: full.timestamp,
    fromAgent: full.fromAgent,
    toAgent: full.toAgent,
    messageType: full.messageType,
    content: full.content,
    findingId: full.findingId ?? null,
    vote: full.vote ?? null,
    metadata: JSON.stringify(full.metadata),
  });

  // Add to recent buffer
  recentMessages.push(full);
  trimRecent();

  // Notify in-process listeners
  const broadcastListeners = listeners.get("all") ?? [];
  const directListeners = full.toAgent !== "all" ? (listeners.get(full.toAgent) ?? []) : [];
  for (const fn of [...broadcastListeners, ...directListeners]) {
    try { fn(full); } catch { /* swallow listener errors */ }
  }

  // Broadcast via WebSocket for the Agent Chat UI
  const persona = mapRoleToPersona(full.fromAgent);
  const emoji = personaEmoji(persona);
  wsServer.broadcast({
    type: "agent_message",
    payload: {
      id: full.id,
      from: full.fromAgent,
      to: full.toAgent,
      messageType: full.messageType,
      content: full.content,
      findingId: full.findingId ?? null,
      vote: full.vote ?? null,
      emoji,
    },
    timestamp: new Date(full.timestamp).toISOString(),
  });

  return full;
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/** Agent broadcasts a finding to all peers. */
export function broadcastFinding(fromAgent: string, findingText: string, findingId: string, meta: Record<string, unknown> = {}): Promise<AgentMessage> {
  return publish({
    fromAgent,
    toAgent: "all",
    messageType: "finding",
    content: findingText,
    findingId,
    vote: null,
    metadata: meta,
  });
}

/** Agent directly messages another agent for peer review. */
export function requestPeerReview(fromAgent: string, toAgent: string, findingText: string, findingId: string): Promise<AgentMessage> {
  return publish({
    fromAgent,
    toAgent,
    messageType: "peer_review",
    content: findingText,
    findingId,
    vote: null,
    metadata: {},
  });
}

/** Agent votes on a finding. */
export function voteFinding(fromAgent: string, findingId: string, vote: "up" | "down"): Promise<AgentMessage> {
  return publish({
    fromAgent,
    toAgent: "all",
    messageType: "vote",
    content: `${vote === "up" ? "👍" : "👎"} ${vote}vote on finding`,
    findingId,
    vote,
    metadata: {},
  });
}

/** Agent escalates a finding to the Mayor. */
export function escalateToMayor(fromAgent: string, findingText: string, findingId: string, evidence: Record<string, unknown> = {}): Promise<AgentMessage> {
  return publish({
    fromAgent,
    toAgent: "mayor",
    messageType: "escalation",
    content: findingText,
    findingId,
    vote: null,
    metadata: evidence,
  });
}

/** Mayor responds to an escalation or agent question. */
export function mayorRespond(content: string, findingId?: string | null): Promise<AgentMessage> {
  return publish({
    fromAgent: "mayor",
    toAgent: "all",
    messageType: "mayor_response",
    content,
    findingId: findingId ?? null,
    vote: null,
    metadata: {},
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Get recent messages from the in-memory buffer (fast). */
export function getRecentMessages(limit = 50): AgentMessage[] {
  return recentMessages.slice(-limit);
}

/** Get the vote tally for a specific finding. */
export async function getVotesForFinding(findingId: string): Promise<{ up: number; down: number }> {
  const rows = await db
    .select({ vote: agentMessagesTable.vote })
    .from(agentMessagesTable)
    .where(and(eq(agentMessagesTable.findingId, findingId), eq(agentMessagesTable.messageType, "vote")));
  let up = 0;
  let down = 0;
  for (const row of rows) {
    if (row.vote === "up") up++;
    else if (row.vote === "down") down++;
  }
  return { up, down };
}

/** Get messages from the DB for a given time window (ms). */
export async function getMessagesInWindow(windowMs: number, limit = 100): Promise<AgentMessage[]> {
  const cutoff = Date.now() - windowMs;
  const rows = await db
    .select()
    .from(agentMessagesTable)
    .where(gte(agentMessagesTable.timestamp, cutoff))
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(limit);

  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    fromAgent: r.fromAgent,
    toAgent: r.toAgent,
    messageType: r.messageType as AgentMessageType,
    content: r.content,
    findingId: r.findingId ?? null,
    vote: (r.vote as "up" | "down" | null) ?? null,
    metadata: safeParseJson(r.metadata),
  }));
}

/** Get all messages involving a specific agent (sent or received). */
export async function getMessagesForAgent(agentId: string, limit = 50): Promise<AgentMessage[]> {
  // Use two queries since drizzle-orm SQLite doesn't have native OR easily for this
  const sent = await db
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.fromAgent, agentId))
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(limit);

  const received = await db
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.toAgent, agentId))
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(limit);

  const combined = [...sent, ...received]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return combined.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    fromAgent: r.fromAgent,
    toAgent: r.toAgent,
    messageType: r.messageType as AgentMessageType,
    content: r.content,
    findingId: r.findingId ?? null,
    vote: (r.vote as "up" | "down" | null) ?? null,
    metadata: safeParseJson(r.metadata),
  }));
}

function safeParseJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}
