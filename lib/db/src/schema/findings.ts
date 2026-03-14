import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const findingsTable = sqliteTable("findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  agentRole: text("agent_role").notNull(),
  buildingId: text("building_id"),
  buildingName: text("building_name"),
  filePath: text("file_path").notNull(),
  fileType: text("file_type"),
  language: text("language").notNull(),
  functionName: text("function_name"),
  lineReference: text("line_reference"),
  finding: text("finding"),
  severity: text("severity").default("LOW").notNull(),
  baseConfidence: real("base_confidence").default(0).notNull(),
  finalConfidence: real("final_confidence").default(0).notNull(),
  classification: text("classification").notNull(),
  status: text("status").default("pending").notNull(),
  source: text("source").notNull(),
  consultedBy: text("consulted_by"),
  metadata: text("metadata").default("{}").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
});

export const insertFindingSchema = createInsertSchema(findingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinding = z.infer<typeof insertFindingSchema>;
export type Finding = typeof findingsTable.$inferSelect;