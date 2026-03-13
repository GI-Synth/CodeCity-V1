import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const metricSnapshotsTable = sqliteTable("metric_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`(datetime('now'))`),
  healthScore: real("health_score").default(0).notNull(),
  coverageOverall: real("coverage_overall").default(0).notNull(),
  activeAgents: integer("active_agents").default(0).notNull(),
  pausedAgents: integer("paused_agents").default(0).notNull(),
  totalBugs: integer("total_bugs").default(0).notNull(),
  kbHitRate: real("kb_hit_rate").default(0).notNull(),
  tasksCompleted: integer("tasks_completed").default(0).notNull(),
  escalationsToday: integer("escalations_today").default(0).notNull(),
  cpuUsage: real("cpu_usage").default(0).notNull(),
  memoryMb: real("memory_mb").default(0).notNull(),
});
