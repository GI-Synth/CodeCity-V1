import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentMessagesTable = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp").notNull(),
  fromAgent: text("from_agent").notNull(),
  toAgent: text("to_agent").notNull(),
  messageType: text("message_type").notNull(),
  content: text("content").notNull(),
  findingId: text("finding_id"),
  vote: text("vote"),
  metadata: text("metadata").default("{}").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const insertAgentMessageSchema = createInsertSchema(agentMessagesTable);
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentMessageRow = typeof agentMessagesTable.$inferSelect;
