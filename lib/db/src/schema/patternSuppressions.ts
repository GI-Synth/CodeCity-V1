import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patternSuppressionsTable = sqliteTable("pattern_suppressions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patternId: text("pattern_id").notNull(),
  filePath: text("file_path"),
  suppressedUntil: text("suppressed_until").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const insertPatternSuppressionSchema = createInsertSchema(patternSuppressionsTable).omit({ id: true });
export type InsertPatternSuppression = z.infer<typeof insertPatternSuppressionSchema>;
export type PatternSuppression = typeof patternSuppressionsTable.$inferSelect;
