import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patternWeightsTable = sqliteTable("pattern_weights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patternId: text("pattern_id").notNull(),
  projectId: text("project_id").default("default").notNull(),
  weight: real("weight").default(1.0).notNull(),
  boostCount: integer("boost_count").default(0).notNull(),
  decayCount: integer("decay_count").default(0).notNull(),
  lastUpdated: text("last_updated").default(sql`(datetime('now'))`).notNull(),
});

export const insertPatternWeightSchema = createInsertSchema(patternWeightsTable).omit({ id: true });
export type InsertPatternWeight = z.infer<typeof insertPatternWeightSchema>;
export type PatternWeight = typeof patternWeightsTable.$inferSelect;
