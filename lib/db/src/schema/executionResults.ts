import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const executionResultsTable = sqliteTable("execution_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  command: text("command").notNull(),
  status: text("status").notNull(),
  exitCode: integer("exit_code"),
  stdout: text("stdout").default("").notNull(),
  stderr: text("stderr").default("").notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  triggeredBy: text("triggered_by").default("alchemist").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});
