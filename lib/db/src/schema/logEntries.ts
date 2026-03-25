import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const logEntriesTable = sqliteTable("log_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp").notNull(),
  level: text("level").notNull(),
  raw: text("raw").notNull(),
  message: text("message").notNull(),
  stackTrace: text("stack_trace"),
  file: text("file"),
  line: integer("line"),
  errorType: text("error_type"),
  perfLabel: text("perf_label"),
  perfDuration: integer("perf_duration"),
  sourceNodeId: text("source_node_id"),
  occurrenceCount: integer("occurrence_count").default(1).notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const insertLogEntrySchema = createInsertSchema(logEntriesTable).omit({ id: true, createdAt: true });
export type InsertLogEntry = z.infer<typeof insertLogEntrySchema>;
export type LogEntry = typeof logEntriesTable.$inferSelect;
