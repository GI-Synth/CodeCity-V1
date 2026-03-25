import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentAccuracyTable = sqliteTable("agent_accuracy", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentRole: text("agent_role").notNull(),
  totalFindings: integer("total_findings").default(0).notNull(),
  truePositives: integer("true_positives").default(0).notNull(),
  falsePositives: integer("false_positives").default(0).notNull(),
  accuracyScore: real("accuracy_score").default(0.8).notNull(),
  lastUpdated: text("last_updated").default(sql`(datetime('now'))`).notNull(),
});

export const insertAgentAccuracySchema = createInsertSchema(agentAccuracyTable).omit({ id: true });
export type InsertAgentAccuracy = z.infer<typeof insertAgentAccuracySchema>;
export type AgentAccuracy = typeof agentAccuracyTable.$inferSelect;
