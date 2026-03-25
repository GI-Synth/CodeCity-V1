import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const reinforcementEventsTable = sqliteTable("reinforcement_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  verdict: text("verdict").notNull(),
  verdictOrigin: text("verdict_origin"),
  issuePattern: text("issue_pattern").notNull(),
  filePath: text("file_path"),
  agentId: text("agent_id"),
  agentName: text("agent_name"),
  agentRole: text("agent_role"),
  findingId: text("finding_id"),
  linkedContext: text("linked_context"),
  personalKbAction: text("personal_kb_action").default("none").notNull(),
  personalKbChanged: integer("personal_kb_changed").default(0).notNull(),
  sharedKnowledgeUpdated: integer("shared_knowledge_updated").default(0).notNull(),
  sharedKnowledgeSeeded: integer("shared_knowledge_seeded").default(0).notNull(),
  qualityDelta: real("quality_delta").default(0).notNull(),
  confidenceDelta: real("confidence_delta").default(0).notNull(),
  attempted: integer("attempted").default(1).notNull(),
  applied: integer("applied").default(0).notNull(),
  cooldownSkipped: integer("cooldown_skipped").default(0).notNull(),
  evidenceScore: real("evidence_score").default(0).notNull(),
});
