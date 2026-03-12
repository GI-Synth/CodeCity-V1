import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentsTable = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").default("idle").notNull(),
  currentBuilding: text("current_building"),
  currentTask: text("current_task"),
  bugsFound: integer("bugs_found").default(0).notNull(),
  testsGenerated: integer("tests_generated").default(0).notNull(),
  escalations: integer("escalations").default(0).notNull(),
  accuracy: real("accuracy").default(0.8).notNull(),
  level: integer("level").default(1).notNull(),
  dialogue: text("dialogue").default("Ready to inspect code...").notNull(),
  x: real("x").default(0).notNull(),
  y: real("y").default(0).notNull(),
  color: text("color").notNull(),
  truePositives: integer("true_positives").default(0).notNull(),
  falsePositives: integer("false_positives").default(0).notNull(),
  escalationCount: integer("escalation_count").default(0).notNull(),
  kbHits: integer("kb_hits").default(0).notNull(),
  rank: text("rank").default("junior").notNull(),
  totalTasksCompleted: integer("total_tasks_completed").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
